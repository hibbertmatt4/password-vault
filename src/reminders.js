'use strict';
// Reminders: your own message, shown as a system notification after a timer or at a date and time,
// once or repeating (every day / week / month / year, e.g. a subscription renewal).
//
// Each computer keeps its reminders in userData/reminders.json, sealed by the operating system (Mac Keychain /
// Windows protected storage) when it can, so they fire while the vault is locked or the window is closed.
// When the vault is synced between computers, they are also kept (encrypted) in the synced vault file and merged
// there (see reminders-merge.js), so a reminder made on one computer turns up on the others.
const { app, safeStorage, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { mergeReminders } = require('./reminders-merge');

const MAX_TEXT = 200;
const MAX_REMINDERS = 200;
const HISTORY_MAX = 50;
const HISTORY_DAYS = 60;
const CHECK_MS = 60 * 60 * 1000; // wake at least hourly (long timers drift; also catches clock changes)
const REPEATS = ['day', 'week', 'month', 'monthEnd', 'year'];
// The last day of d's month, at d's time of day.
const monthEnd = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, d.getHours(), d.getMinutes(), d.getSeconds());

let list = []; // upcoming
let history = []; // already shown: { id, text, at (when it was due), loginId, loginTitle, repeat, shownAt, unseen }
let gone = {}; // upcoming reminders cancelled or used up: id → when (so other computers drop them too)
let hgone = {}; // sent reminders removed: id → when
let timer = null;
let onFire = () => {};
let onChange = () => {}; // something changed on this computer (main.js saves it to the synced vault)
const shown = []; // keep notifications referenced so their click handlers survive
const nowIso = () => new Date().toISOString();

const file = () => path.join(app.getPath('userData'), 'reminders.json');
const valid = (r) => r && r.id && r.at && r.text;

// Reminders are precious and live in one small file, so it's written safely: to a temporary file first, then
// swapped in, with the previous good copy kept as reminders.json.bak. If the file can't be read (cut short by a
// crash or power cut, or sealed by a key that's no longer available), the backup is used, and the unreadable file
// is kept aside (never silently overwritten) so nothing is lost for good.
const backupFile = () => file() + '.bak';

function parseFile(p) {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const parsed = raw.sealed ? JSON.parse(safeStorage.decryptString(Buffer.from(raw.sealed, 'base64'))) : raw;
  // 1.9.0 saved a plain list of upcoming reminders.
  const data = Array.isArray(parsed) ? { list: parsed } : parsed || {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return {
    list: Array.isArray(data.list) ? data.list.filter(valid) : [],
    history: Array.isArray(data.history) ? data.history.filter(valid) : [],
    gone: obj(data.gone),
    hgone: obj(data.hgone),
  };
}

function load() {
  list = [];
  history = [];
  gone = {};
  hgone = {};
  if (!fs.existsSync(file()) && !fs.existsSync(backupFile())) return; // first run
  for (const p of [file(), backupFile()]) {
    try {
      if (!fs.existsSync(p)) continue;
      ({ list, history, gone, hgone } = parseFile(p));
      if (p !== file()) {
        // restored from the backup: keep the unreadable main file aside, then write a good one
        if (fs.existsSync(file())) fs.copyFileSync(file(), path.join(path.dirname(file()), `reminders.unreadable-${Date.now()}.json`));
        save({ quiet: true });
      }
      return;
    } catch {
      // try the next one
    }
  }
  // Neither could be read: keep the unreadable file aside rather than overwriting it later.
  try {
    fs.copyFileSync(file(), path.join(path.dirname(file()), `reminders.unreadable-${Date.now()}.json`));
  } catch {
    /* nothing to keep */
  }
}

function save({ quiet = false } = {}) {
  try {
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString();
    history = history.filter((h) => (h.shownAt || h.at) >= cutoff).slice(-HISTORY_MAX);
    for (const m of [gone, hgone]) for (const id of Object.keys(m)) if (m[id] < cutoff) delete m[id];
    const data = { list, history, gone, hgone };
    const body = safeStorage.isEncryptionAvailable() ? { sealed: safeStorage.encryptString(JSON.stringify(data)).toString('base64') } : data;
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
    try {
      parseFile(tmp); // only swap it in if it reads back correctly
    } catch {
      fs.rmSync(tmp, { force: true });
      return;
    }
    fs.renameSync(tmp, file());
    fs.copyFileSync(file(), backupFile()); // a second, identical copy to fall back on
  } catch {
    /* kept in memory until the next save */
  }
  if (!quiet) onChange();
}

const sorted = () => [...list].sort((a, b) => a.at.localeCompare(b.at));

// One repeat step after `start`, n times (in local time, so 9:00 stays 9:00; the 31st becomes the last day
// of shorter months; "monthEnd" is always the last day: 28th, 29th, 30th or 31st).
function stepFrom(start, unit, n) {
  const d = new Date(start);
  if (unit === 'monthEnd') return monthEnd(new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), d.getSeconds()));
  if (unit === 'day') d.setDate(d.getDate() + n);
  else if (unit === 'week') d.setDate(d.getDate() + 7 * n);
  else {
    const months = unit === 'year' ? 12 * n : n;
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  return d;
}

/** The next time a repeating reminder is due after `now`. */
function nextAt(r, now) {
  const start = new Date(r.startAt || r.at);
  for (let n = 1; n < 100000; n++) {
    const d = stepFrom(start, r.repeat, n);
    if (d > now) return d.toISOString();
  }
  return null;
}

function schedule() {
  clearTimeout(timer);
  const next = sorted()[0];
  if (!next) return;
  const wait = Math.max(0, Math.min(new Date(next.at) - Date.now(), CHECK_MS));
  timer = setTimeout(fireDue, wait);
}

// Show every reminder whose time has come (including ones missed while the computer was off — a repeating one
// shows once, not once for every time it was missed). One-off reminders then move to the history; repeating
// ones move on to their next time.
function fireDue() {
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const due = list.filter((r) => new Date(r.at) <= now);
  if (due.length) {
    for (const r of due) {
      const id = `${r.id}@${r.at}`;
      // unseen: the user hasn't looked at it yet (see missed())
      if (!history.some((h) => h.id === id)) {
        history.push({ id, reminderId: r.id, text: r.text, at: r.at, loginId: r.loginId, loginTitle: r.loginTitle, repeat: r.repeat || null, shownAt: stamp, updatedAt: stamp, unseen: true });
      }
      show(r, now - new Date(r.at) > 5 * 60 * 1000);
    }
    list = list
      .map((r) => {
        if (!due.includes(r)) return r;
        const at = REPEATS.includes(r.repeat) ? nextAt(r, now) : null;
        if (!at) {
          gone[r.id] = stamp; // used up: other computers drop it too
          return null;
        }
        return { ...r, at, updatedAt: stamp };
      })
      .filter(Boolean);
    save();
    onFire(due);
  }
  schedule();
}

function show(r, late) {
  if (!Notification.isSupported()) return;
  const when = late ? ` (was due ${new Date(r.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })})` : '';
  const n = new Notification({ title: (r.loginTitle ? `Reminder: ${r.loginTitle}` : 'Password Vault reminder') + when, body: r.text });
  n.on('click', () => onFire([r], true));
  shown.push(n);
  if (shown.length > 20) shown.shift();
  n.show();
}

/** Start up: load saved reminders, fire any that came due while the app wasn't running. */
function init(handler) {
  onFire = handler || onFire;
  load();
  fireDue();
}

/** Upcoming reminders (soonest first) and ones already shown (newest first). */
function all() {
  return { upcoming: sorted(), recent: [...history].sort((a, b) => (b.shownAt || b.at).localeCompare(a.shownAt || a.at)) };
}

// Checks and tidies a reminder's text, time and repeat. Throws a message the user can read.
function checked({ text, at, repeat }) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
  if (!clean) throw new Error('Type what you want to be reminded about.');
  let when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error('Choose when to be reminded.');
  if (repeat === 'monthEnd') when = monthEnd(when);
  if (when <= Date.now()) throw new Error('Choose a time in the future.');
  return { text: clean, at: when.toISOString(), repeat: REPEATS.includes(repeat) ? repeat : null };
}

/** Add one: { text, at (ISO date), repeat? ('day'|'week'|'month'|'year'), loginId?, loginTitle? }. */
function add({ text, at, repeat, loginId, loginTitle }) {
  const c = checked({ text, at, repeat });
  if (list.length >= MAX_REMINDERS) throw new Error('You have too many reminders. Cancel some first.');
  const stamp = nowIso();
  const r = {
    id: crypto.randomUUID(),
    text: c.text,
    at: c.at,
    startAt: c.at,
    repeat: c.repeat,
    loginId: loginId ? String(loginId) : null,
    loginTitle: loginTitle ? String(loginTitle).slice(0, 100) : null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  list.push(r);
  save();
  schedule();
  return r;
}

/** Change an upcoming reminder's message, time or repeat. */
function update(id, { text, at, repeat }) {
  const r = list.find((x) => x.id === id);
  if (!r) throw new Error('That reminder isn’t there any more.');
  const c = checked({ text, at, repeat });
  Object.assign(r, { text: c.text, at: c.at, startAt: c.at, repeat: c.repeat, updatedAt: nowIso() });
  save();
  schedule();
  return r;
}

/** Run a sent reminder again (new time / repeat, message editable): it moves from "sent" back to upcoming. */
function again(historyId, { text, at, repeat }) {
  const h = history.find((x) => x.id === historyId);
  if (!h) throw new Error('That reminder isn’t there any more.');
  const r = add({ text, at, repeat, loginId: h.loginId, loginTitle: h.loginTitle }); // (throws if it isn't valid)
  history = history.filter((x) => x.id !== historyId);
  hgone[historyId] = nowIso();
  save();
  return r;
}

/** Cancel an upcoming reminder, or remove one from the history. */
function remove(id) {
  const stamp = nowIso();
  if (list.some((r) => r.id === id)) gone[id] = stamp;
  if (history.some((h) => h.id === id)) hgone[id] = stamp;
  list = list.filter((r) => r.id !== id);
  history = history.filter((h) => h.id !== id);
  save();
  schedule();
}

function clearHistory() {
  const stamp = nowIso();
  for (const h of history) hgone[h.id] = stamp;
  history = [];
  save();
}

/** Keep the login name in reminders current when the login is renamed. */
function loginChanged(id, title) {
  let changed = false;
  const stamp = nowIso();
  for (const r of [...list, ...history]) {
    if (r.loginId === id && r.loginTitle !== title) {
      r.loginTitle = title;
      r.updatedAt = stamp;
      changed = true;
    }
  }
  if (changed) save();
}

/** A login was deleted: cancel its upcoming reminders. */
function loginDeleted(id) {
  const stamp = nowIso();
  const before = list.length;
  for (const r of list) if (r.loginId === id) gone[r.id] = stamp;
  list = list.filter((r) => r.loginId !== id);
  if (list.length !== before) {
    save();
    schedule();
  }
}

// ---------- sharing between computers ----------
const withTime = (r) => ({ ...r, updatedAt: r.updatedAt || r.createdAt || r.shownAt || r.at });
const byId = (arr) => Object.fromEntries(arr.map((r) => { const { unseen, ...rest } = withTime(r); return [rest.id, rest]; })); // eslint-disable-line no-unused-vars

/** Everything on this computer, in the form that's saved in the synced vault and merged there. */
function exportState() {
  return { list: byId(list), gone: { ...gone }, history: byId(history), hgone: { ...hgone } };
}

/**
 * Merge the reminders found in the synced vault (made on this or another computer) into this computer's.
 * Returns true when that changed anything here.
 */
function importState(remote) {
  if (!remote) return false;
  const mine = exportState();
  const merged = mergeReminders(mine, remote);
  if (JSON.stringify(merged) === JSON.stringify(mergeReminders(mine, mine))) return false;
  const seen = new Map(history.map((h) => [h.id, h.unseen]));
  list = Object.values(merged.list).filter(valid);
  history = Object.values(merged.history)
    .filter(valid)
    .map((h) => ({ ...h, unseen: seen.get(h.id) === true })); // (ones that were sent on another computer aren't "missed" here)
  gone = merged.gone;
  hgone = merged.hgone;
  save({ quiet: true });
  schedule();
  return true;
}

/** Reminders that went off while the user wasn't looking and haven't been dismissed (oldest first). */
function missed() {
  return history.filter((h) => h.unseen).sort((a, b) => a.at.localeCompare(b.at));
}

/** The user has seen these (they opened the app from the notification, or were in the app when it went off). */
function markSeen(items) {
  const ids = new Set((items || []).map((x) => (typeof x === 'string' ? x : `${x.id}@${x.at}`)));
  let changed = false;
  for (const h of history) {
    if (h.unseen && ids.has(h.id)) {
      h.unseen = false;
      changed = true;
    }
  }
  if (changed) save({ quiet: true });
}

/** The user closed the "a reminder went off" message. */
function dismissMissed() {
  let changed = false;
  for (const h of history) if (h.unseen) (h.unseen = false), (changed = true);
  if (changed) save({ quiet: true });
}

module.exports = {
  init,
  all,
  missed,
  markSeen,
  dismissMissed,
  add,
  update,
  again,
  remove,
  clearHistory,
  loginChanged,
  loginDeleted,
  exportState,
  importState,
  setOnChange: (fn) => (onChange = fn),
  check: fireDue,
  _stepFrom: stepFrom,
};
