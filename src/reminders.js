'use strict';
// Reminders: your own message, shown as a system notification after a timer or at a date and time.
// Kept on this computer only (userData/reminders.json), sealed by the operating system (Mac Keychain /
// Windows protected storage) when it can, so they can fire while the vault is locked or the window is closed.
const { app, safeStorage, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_TEXT = 200;
const MAX_REMINDERS = 200;
const CHECK_MS = 60 * 60 * 1000; // wake at least hourly (long timers drift; also catches clock changes)

let list = [];
let timer = null;
let onFire = () => {};
const shown = []; // keep notifications referenced so their click handlers survive

const file = () => path.join(app.getPath('userData'), 'reminders.json');

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const json = raw.sealed ? safeStorage.decryptString(Buffer.from(raw.sealed, 'base64')) : JSON.stringify(raw.list || []);
    const parsed = JSON.parse(json);
    list = Array.isArray(parsed) ? parsed.filter((r) => r && r.id && r.at && r.text) : [];
  } catch {
    list = [];
  }
}

function save() {
  try {
    const json = JSON.stringify(list);
    const body = safeStorage.isEncryptionAvailable() ? { sealed: safeStorage.encryptString(json).toString('base64') } : { list };
    fs.writeFileSync(file(), JSON.stringify(body), { mode: 0o600 });
  } catch {
    /* kept in memory until the next save */
  }
}

const sorted = () => [...list].sort((a, b) => a.at.localeCompare(b.at));

function schedule() {
  clearTimeout(timer);
  const next = sorted()[0];
  if (!next) return;
  const wait = Math.max(0, Math.min(new Date(next.at) - Date.now(), CHECK_MS));
  timer = setTimeout(fireDue, wait);
}

// Show every reminder whose time has come (including ones missed while the computer was off), then forget them.
function fireDue() {
  const now = Date.now();
  const due = list.filter((r) => new Date(r.at) <= now);
  if (due.length) {
    list = list.filter((r) => !due.includes(r));
    save();
    for (const r of due) show(r, now - new Date(r.at) > 5 * 60 * 1000);
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

function all() {
  return sorted();
}

/** Add one: { text, at (ISO date), loginId?, loginTitle? }. */
function add({ text, at, loginId, loginTitle }) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
  if (!clean) throw new Error('Type what you want to be reminded about.');
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error('Choose when to be reminded.');
  if (when <= Date.now()) throw new Error('Choose a time in the future.');
  if (list.length >= MAX_REMINDERS) throw new Error('You have too many reminders. Cancel some first.');
  const r = {
    id: crypto.randomUUID(),
    text: clean,
    at: when.toISOString(),
    loginId: loginId ? String(loginId) : null,
    loginTitle: loginTitle ? String(loginTitle).slice(0, 100) : null,
    createdAt: new Date().toISOString(),
  };
  list.push(r);
  save();
  schedule();
  return r;
}

function remove(id) {
  list = list.filter((r) => r.id !== id);
  save();
  schedule();
}

/** Keep the login name in a reminder current when the login is renamed. */
function loginChanged(id, title) {
  let changed = false;
  for (const r of list) if (r.loginId === id && r.loginTitle !== title) (r.loginTitle = title), (changed = true);
  if (changed) save();
}

module.exports = { init, all, add, remove, loginChanged, check: fireDue };
