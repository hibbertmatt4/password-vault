'use strict';
// Reminders: your own message, shown as a system notification after a timer or at a date and time,
// once or repeating (every day / week / month / year, e.g. a subscription renewal).
// Kept on this computer only (userData/reminders.json), sealed by the operating system (Mac Keychain /
// Windows protected storage) when it can, so they can fire while the vault is locked or the window is closed.
const { app, safeStorage, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_TEXT = 200;
const MAX_REMINDERS = 200;
const HISTORY_MAX = 50;
const HISTORY_DAYS = 60;
const CHECK_MS = 60 * 60 * 1000; // wake at least hourly (long timers drift; also catches clock changes)
const REPEATS = ['day', 'week', 'month', 'monthEnd', 'year'];
// The last day of d's month, at d's time of day.
const monthEnd = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, d.getHours(), d.getMinutes(), d.getSeconds());

let list = []; // upcoming
let history = []; // already shown: { id, text, at (when it was due), loginId, loginTitle, repeat, shownAt }
let timer = null;
let onFire = () => {};
const shown = []; // keep notifications referenced so their click handlers survive

const file = () => path.join(app.getPath('userData'), 'reminders.json');
const valid = (r) => r && r.id && r.at && r.text;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const parsed = raw.sealed ? JSON.parse(safeStorage.decryptString(Buffer.from(raw.sealed, 'base64'))) : raw;
    // 1.9.0 saved a plain list of upcoming reminders.
    const data = Array.isArray(parsed) ? { list: parsed } : parsed || {};
    list = Array.isArray(data.list) ? data.list.filter(valid) : [];
    history = Array.isArray(data.history) ? data.history.filter(valid) : [];
  } catch {
    list = [];
    history = [];
  }
}

function save() {
  try {
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString();
    history = history.filter((h) => (h.shownAt || h.at) >= cutoff).slice(-HISTORY_MAX);
    const data = { list, history };
    const body = safeStorage.isEncryptionAvailable() ? { sealed: safeStorage.encryptString(JSON.stringify(data)).toString('base64') } : data;
    fs.writeFileSync(file(), JSON.stringify(body), { mode: 0o600 });
  } catch {
    /* kept in memory until the next save */
  }
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
  const due = list.filter((r) => new Date(r.at) <= now);
  if (due.length) {
    for (const r of due) {
      // unseen: the user hasn't looked at it yet (see missed())
      history.push({ id: `${r.id}@${r.at}`, reminderId: r.id, text: r.text, at: r.at, loginId: r.loginId, loginTitle: r.loginTitle, repeat: r.repeat || null, shownAt: new Date(now).toISOString(), unseen: true });
      show(r, now - new Date(r.at) > 5 * 60 * 1000);
    }
    list = list
      .map((r) => {
        if (!due.includes(r)) return r;
        if (!REPEATS.includes(r.repeat)) return null;
        const at = nextAt(r, now);
        return at ? { ...r, at } : null;
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
  if (changed) save();
}

/** The user closed the "a reminder went off" message. */
function dismissMissed() {
  let changed = false;
  for (const h of history) if (h.unseen) (h.unseen = false), (changed = true);
  if (changed) save();
}

/** Add one: { text, at (ISO date), repeat? ('day'|'week'|'month'|'year'), loginId?, loginTitle? }. */
function add({ text, at, repeat, loginId, loginTitle }) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
  if (!clean) throw new Error('Type what you want to be reminded about.');
  let when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error('Choose when to be reminded.');
  if (repeat === 'monthEnd') when = monthEnd(when);
  if (when <= Date.now()) throw new Error('Choose a time in the future.');
  if (list.length >= MAX_REMINDERS) throw new Error('You have too many reminders. Cancel some first.');
  const r = {
    id: crypto.randomUUID(),
    text: clean,
    at: when.toISOString(),
    startAt: when.toISOString(),
    repeat: REPEATS.includes(repeat) ? repeat : null,
    loginId: loginId ? String(loginId) : null,
    loginTitle: loginTitle ? String(loginTitle).slice(0, 100) : null,
    createdAt: new Date().toISOString(),
  };
  list.push(r);
  save();
  schedule();
  return r;
}

/** Cancel an upcoming reminder, or remove one from the history. */
function remove(id) {
  list = list.filter((r) => r.id !== id);
  history = history.filter((h) => h.id !== id);
  save();
  schedule();
}

function clearHistory() {
  history = [];
  save();
}

/** Keep the login name in reminders current when the login is renamed. */
function loginChanged(id, title) {
  let changed = false;
  for (const r of [...list, ...history]) if (r.loginId === id && r.loginTitle !== title) (r.loginTitle = title), (changed = true);
  if (changed) save();
}

/** A login was deleted: cancel its upcoming reminders. */
function loginDeleted(id) {
  const before = list.length;
  list = list.filter((r) => r.loginId !== id);
  if (list.length !== before) {
    save();
    schedule();
  }
}

module.exports = { init, all, missed, markSeen, dismissMissed, add, remove, clearHistory, loginChanged, loginDeleted, check: fireDue, _stepFrom: stepFrom };
