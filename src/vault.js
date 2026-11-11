'use strict';
// Encrypted vault storage, safe to keep in a cloud-synced folder.
// - Key derivation: scrypt (N=2^17, r=8, p=1) from the master password + random 32-byte salt.
// - Encryption: AES-256-GCM with a fresh random 12-byte IV on every save (authenticated, tamper-evident).
// - The master password is never stored. Only the derived key is held in memory while unlocked.
// - Sync: before every save the file on disk is re-read; if another computer changed it, both
//   versions are merged login-by-login (newest edit wins, deletions are remembered), so nothing
//   is silently overwritten.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { mergeReminders } = require('./reminders-merge');

const KDF = { name: 'scrypt', N: 131072, r: 8, p: 1, keyLen: 32 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const TOMBSTONE_DAYS = 365; // how long a deletion is remembered (so an offline computer can't bring it back)

function deriveKey(password, salt, kdf = KDF) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize('NFKC'),
      salt,
      kdf.keyLen,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: SCRYPT_MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

function encrypt(key, plaintextObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plaintextObj), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(key, payload) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8'));
}

// A login's picture: a known brand logo, an emoji, or an uploaded image (kept small, stored encrypted).
const MAX_IMAGE_CHARS = 200 * 1024;
function cleanIcon(icon) {
  if (!icon || typeof icon !== 'object') return null;
  if (icon.type === 'letter') return { type: 'letter' }; // "always show the first letter" (no automatic logo)
  if (icon.type === 'brand' && /^[a-z0-9]{1,40}$/.test(String(icon.id))) return { type: 'brand', id: String(icon.id) };
  if (icon.type === 'emoji' && typeof icon.value === 'string' && icon.value.trim() && [...icon.value].length <= 8) {
    return { type: 'emoji', value: icon.value.trim() };
  }
  if (icon.type === 'image' && typeof icon.data === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon.data) && icon.data.length <= MAX_IMAGE_CHARS) {
    return { type: 'image', data: icon.data };
  }
  return null;
}

// Files attached to a login, kept (encrypted) inside the vault: { id, name, type, size, data (base64), addedAt }.
// The whole vault is saved and synced in one piece, so files are kept reasonably small.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LOGIN_FILES_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20;
const MAX_NOTES_HTML = 8 * 1024 * 1024; // formatted notes, including pictures
const cleanFileName = (n) =>
  String(n || 'file')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 120) || 'file';
const cleanFileType = (t) => (/^[\w.+-]{1,60}\/[\w.+-]{1,80}$/.test(String(t || '')) ? String(t) : 'application/octet-stream');
const base64Bytes = (b) => Math.floor((b.length * 3) / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0);

// Subsites: other pages of a login's website that can be opened directly, each with a short description.
const MAX_SUBSITES = 30;
function cleanSubsites(list, existing) {
  if (list === undefined) return existing || [];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(0, MAX_SUBSITES)) {
    if (!s || typeof s !== 'object') continue;
    const url = String(s.url || '').trim().slice(0, 500);
    if (!url) continue; // a row with no address is just an empty row
    out.push({
      id: typeof s.id === 'string' && /^[\w-]{1,64}$/.test(s.id) ? s.id : crypto.randomUUID(),
      url,
      description: String(s.description || '').trim().slice(0, 200),
    });
  }
  return out;
}

/** Check a login's files. Ones sent without `data` keep the data they already had (matched by id). */
function cleanAttachments(list, existing, now) {
  if (list === undefined) return existing || [];
  if (!Array.isArray(list)) return [];
  const old = new Map((existing || []).map((a) => [a.id, a]));
  const out = [];
  let total = 0;
  for (const a of list.slice(0, MAX_FILES)) {
    if (!a || typeof a !== 'object') continue;
    const prev = old.get(a.id);
    const data = typeof a.data === 'string' ? a.data : prev ? prev.data : null;
    if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) continue;
    const name = cleanFileName(a.name);
    const size = base64Bytes(data);
    if (size > MAX_FILE_BYTES) throw new Error(`“${name}” is too big. Files can be up to 10 MB.`);
    total += size;
    if (total > MAX_LOGIN_FILES_BYTES) throw new Error('The files on one login can add up to 25 MB at most.');
    out.push({
      id: prev ? prev.id : /^[\w-]{1,64}$/.test(String(a.id)) ? String(a.id) : crypto.randomUUID(),
      name,
      type: cleanFileType(a.type),
      size,
      data,
      addedAt: prev ? prev.addedAt : now,
    });
  }
  return out;
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Older vaults stored a plain array of entries, and had no folder list.
// folders: { name: createdAt } (so empty folders exist), folderDeleted: { name: deletedAt }.
function normalize(payload) {
  if (Array.isArray(payload)) return { entries: payload, deleted: {}, folders: {}, folderDeleted: {} };
  return {
    entries: payload.entries || [],
    deleted: payload.deleted || {},
    folders: payload.folders || {},
    folderDeleted: payload.folderDeleted || {},
  };
}

// Keep the newest timestamp for each key.
function newest(a, b) {
  const out = { ...a };
  for (const [k, at] of Object.entries(b)) if (!out[k] || at > out[k]) out[k] = at;
  return out;
}

// Combine two copies of the vault. Newest edit of each login wins; a deletion beats any edit made before it.
// Folders: a folder exists unless it was deleted after it was (last) created.
function merge(a, b) {
  a = normalize(a);
  b = normalize(b);
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 864e5).toISOString();
  const deleted = newest(a.deleted, b.deleted);
  for (const [id, at] of Object.entries(deleted)) if (at < cutoff) delete deleted[id];

  const byId = new Map();
  for (const e of [...a.entries, ...b.entries]) {
    const cur = byId.get(e.id);
    if (!cur || (e.updatedAt || '') > (cur.updatedAt || '')) byId.set(e.id, e);
  }
  const entries = [...byId.values()].filter((e) => !(deleted[e.id] && deleted[e.id] >= (e.updatedAt || '')));

  const folderDeleted = newest(a.folderDeleted, b.folderDeleted);
  for (const [n, at] of Object.entries(folderDeleted)) if (at < cutoff) delete folderDeleted[n];
  const folders = {};
  for (const [n, at] of Object.entries(newest(a.folders, b.folders))) if (!(folderDeleted[n] && folderDeleted[n] >= at)) folders[n] = at;
  return { entries, deleted, folders, folderDeleted };
}

const sameData = (a, b) => JSON.stringify(sortData(a)) === JSON.stringify(sortData(b));
function sortData(d) {
  d = normalize(d);
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort());
  return {
    entries: [...d.entries].sort((x, y) => x.id.localeCompare(y.id)),
    deleted: sortObj(d.deleted),
    folders: sortObj(d.folders),
    folderDeleted: sortObj(d.folderDeleted),
  };
}

// Folders can sit inside folders. A folder is stored as its path, e.g. "Banking/Personal", so older copies of
// the app (and the sync merge) still treat each one as a plain name.
const FOLDER_SEP = '/';
const MAX_FOLDER_DEPTH = 8;
const cleanFolderPart = (name) => String(name || '').replace(/\//g, '-').trim().replace(/\s+/g, ' ').slice(0, 60);
const cleanFolderName = (path) =>
  String(path || '')
    .split(FOLDER_SEP)
    .map(cleanFolderPart)
    .filter(Boolean)
    .slice(0, MAX_FOLDER_DEPTH)
    .join(FOLDER_SEP);
const folderParent = (path) => (path.includes(FOLDER_SEP) ? path.slice(0, path.lastIndexOf(FOLDER_SEP)) : '');
const isInside = (path, folder) => path === folder || path.startsWith(folder + FOLDER_SEP);
// Every folder above this one: "A/B/C" → ["A", "A/B"].
function folderAncestors(path) {
  const parts = path.split(FOLDER_SEP);
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join(FOLDER_SEP));
}

// Which kind of computer made an edit, so the other computer can say "updated on your Mac".
const THIS_DEVICE = process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows PC' : 'computer';

// ---------- change feed (for notifications while locked) ----------
// Each save also writes a short list of recent changes (login name, added/updated/deleted, which computer).
// It's encrypted with a separate "notify key" derived one-way from the vault key, which each computer keeps
// sealed by the operating system. So a locked app can still say "GitHub was updated on your Mac", while the
// notify key can never be used to read passwords.
const FEED_MAX = 100;
const FEED_DAYS = 30;
let deviceId = null; // random id for this computer, so it doesn't notify itself
const setDeviceId = (id) => (deviceId = id || null);
const notifyKeyFrom = (key) => Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), 'password-vault notify feed v1', 32));

function decryptFeed(notifyKey, file) {
  try {
    if (!file || !file.feed) return null;
    const list = decrypt(notifyKey, file.feed);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

// Settings shared by all computers using this vault (e.g. which notifications to show): { updatedAt, notify: {...} }.
// Encrypted with the notify key too, so a locked computer can still follow them.
function decryptShared(notifyKey, file) {
  try {
    if (!file || !file.shared) return null;
    const s = decrypt(notifyKey, file.shared);
    return s && typeof s === 'object' && s.updatedAt ? s : null;
  } catch {
    return null;
  }
}
// Two copies of the shared settings: the newer one's settings win, but reminders are merged one by one, so a
// reminder made on one computer is never lost to a newer save from another.
function newerShared(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = { ...(b.updatedAt > a.updatedAt ? b : a) };
  if (a.reminders || b.reminders) out.reminders = mergeReminders(a.reminders, b.reminders);
  return out;
}

/** Read a vault file's shared settings with a notify key (works while locked), or null. */
function readShared(filePath, notifyKey) {
  try {
    return decryptShared(notifyKey, JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

/** Read a vault file's change feed with a notify key (works while locked). Null if there's none or the key doesn't fit. */
function readFeed(filePath, notifyKey) {
  try {
    return decryptFeed(notifyKey, JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

// The parts of a login an edit can change (to say e.g. "GitHub: icon changed").
const ENTRY_FIELDS = ['kind', 'title', 'username', 'password', 'url', 'notes', 'notesHtml', 'attachments', 'icon', 'folder', 'subsites'];

// Folders created or removed between two copies of the vault: [{ kind: added|deleted, name }].
function diffFolders(before, after) {
  const has = (d) => {
    const n = normalize(d);
    const names = new Set(Object.keys(n.folders));
    for (const e of n.entries) if (e.folder) names.add(e.folder);
    return names;
  };
  const a = has(before);
  const b = has(after);
  return [...[...b].filter((n) => !a.has(n)).map((name) => ({ kind: 'added', name })), ...[...a].filter((n) => !b.has(n)).map((name) => ({ kind: 'deleted', name }))];
}

// A frozen copy of the login list (edits replace the list and its items, but never change them in place).
const snapshot = (data) => ({ entries: [...normalize(data).entries] });

// What changed between two copies of the vault, login by login: [{ kind: added|updated|deleted, id, title, changedOn }].
function diffEntries(before, after) {
  const old = new Map(normalize(before).entries.map((e) => [e.id, e]));
  const now = new Map(normalize(after).entries.map((e) => [e.id, e]));
  const out = [];
  for (const [id, e] of now) {
    const prev = old.get(id);
    if (!prev) out.push({ kind: 'added', id, title: e.title, changedOn: e.changedOn || null });
    else if ((e.updatedAt || '') !== (prev.updatedAt || '')) {
      const fields = ENTRY_FIELDS.filter((f) => JSON.stringify(e[f] ?? null) !== JSON.stringify(prev[f] ?? null));
      out.push({ kind: 'updated', id, title: e.title, changedOn: e.changedOn || null, fields });
    }
  }
  for (const [id, e] of old) if (!now.has(id)) out.push({ kind: 'deleted', id, title: e.title, changedOn: null });
  return out;
}

class Vault {
  /**
   * @param {string} filePath where the encrypted vault lives (may be inside a cloud-synced folder)
   * @param {string} backupDir a folder on this computer only, for backups and merged conflict copies
   */
  constructor(filePath, backupDir) {
    this.filePath = filePath;
    this.backupDir = backupDir || path.join(path.dirname(filePath), 'backups');
    this.key = null;
    this.salt = null;
    this.kdf = null;
    this.data = null; // { entries, deleted }
    this.lastHash = null; // hash of the file as we last read or wrote it
    this.seenHash = null; // the file as it was when we locked (to notice other computers' edits while locked)
    this.lastSync = null;
    this.remoteChanges = new Map(); // logins changed by another computer, not yet reported (id → change)
    this.notifyKey = null; // decrypts the change feed (see above)
    this.diskData = null; // the vault as it is in the file on disk, to tell which changes a save adds
    this.shared = null; // settings shared by all computers (see decryptShared)
  }

  /** Change the settings shared by all computers and save them straight away. */
  setShared(values) {
    this._requireUnlocked();
    this.syncFromDisk();
    this._requireUnlocked();
    this.shared = { ...(this.shared || {}), ...values, updatedAt: new Date().toISOString() };
    this._write();
    return this.shared;
  }

  /**
   * Reminders made on this computer join the ones in the file, so every computer sharing the vault sees them.
   * Returns true when that changed the file.
   */
  setSharedReminders(state) {
    this._requireUnlocked();
    this.syncFromDisk();
    this._requireUnlocked();
    const current = this.shared && this.shared.reminders;
    const merged = mergeReminders(current, state);
    if (JSON.stringify(merged) === JSON.stringify(mergeReminders(current, current))) return false; // nothing new
    this.shared = { ...(this.shared || {}), reminders: merged, updatedAt: (this.shared && this.shared.updatedAt) || new Date().toISOString() };
    this._write();
    return true;
  }

  /** Changes other computers made since the last call (and forget them). */
  takeRemoteChanges() {
    const list = [...this.remoteChanges.values()];
    this.remoteChanges.clear();
    return list;
  }

  /** Folders other computers created or removed since the last call (and forget them). */
  takeRemoteFolderChanges() {
    const list = this.remoteFolders || [];
    this.remoteFolders = [];
    return list;
  }

  _noteRemote(before, after) {
    for (const c of diffEntries(before, after)) {
      const prev = this.remoteChanges.get(c.id);
      // "added" then "updated" before we reported it is still just "added"; edits add up.
      if (prev && prev.kind === 'added' && c.kind === 'updated') this.remoteChanges.set(c.id, { ...c, kind: 'added', fields: undefined });
      else if (prev && prev.kind === 'updated' && c.kind === 'updated') this.remoteChanges.set(c.id, { ...c, fields: [...new Set([...(prev.fields || []), ...(c.fields || [])])] });
      else this.remoteChanges.set(c.id, c);
    }
    this.remoteFolders = [...(this.remoteFolders || []), ...diffFolders(before, after)];
  }

  /** Hash of the vault file on disk right now (works while locked), or null. */
  fileHash() {
    try {
      return sha256(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  isUnlocked() {
    return this.key !== null;
  }

  async create(masterPassword) {
    if (this.exists()) throw new Error('A vault already exists.');
    this.salt = crypto.randomBytes(32);
    this.kdf = { ...KDF };
    this.key = await deriveKey(masterPassword, this.salt, this.kdf);
    this.notifyKey = notifyKeyFrom(this.key);
    this.data = { entries: [], deleted: {}, folders: {}, folderDeleted: {} };
    this._write();
  }

  async unlock(masterPassword) {
    const { file, hash } = this._read();
    const salt = Buffer.from(file.salt, 'base64');
    const key = await deriveKey(masterPassword, salt, file.kdf);
    let data;
    try {
      data = normalize(decrypt(key, file.vault));
    } catch {
      key.fill(0);
      return false; // wrong password (or tampered file)
    }
    this.salt = salt;
    this.kdf = file.kdf;
    this.key = key;
    this.notifyKey = notifyKeyFrom(key);
    this.shared = decryptShared(this.notifyKey, file);
    this.data = data;
    this.diskData = snapshot(data);
    this.lastHash = hash;
    this.lastSync = new Date();
    this.mergeConflictCopies();
    return true;
  }

  /** Unlock with a previously derived key (Touch ID / Windows Hello). False if it no longer fits. */
  unlockWithKey(key) {
    const { file, hash } = this._read();
    let data;
    try {
      data = normalize(decrypt(key, file.vault));
    } catch {
      return false; // master password was changed since the key was stored
    }
    this.salt = Buffer.from(file.salt, 'base64');
    this.kdf = file.kdf;
    this.key = Buffer.from(key);
    this.notifyKey = notifyKeyFrom(this.key);
    this.shared = decryptShared(this.notifyKey, file);
    this.data = data;
    this.diskData = snapshot(data);
    this.lastHash = hash;
    this.lastSync = new Date();
    this.mergeConflictCopies();
    return true;
  }

  /** What Touch ID / Windows Hello needs to store (only while unlocked). */
  keyInfo() {
    this._requireUnlocked();
    return { key: Buffer.from(this.key), salt: this.salt.toString('base64'), filePath: this.filePath };
  }

  /** The salt in the file on disk (identifies which master password it was made with). */
  fileSalt() {
    try {
      return this._read().file.salt;
    } catch {
      return null;
    }
  }

  lock() {
    if (this.lastHash) this.seenHash = this.lastHash;
    if (this.key) this.key.fill(0);
    if (this.notifyKey) this.notifyKey.fill(0);
    this.key = null;
    this.notifyKey = null;
    this.shared = null;
    this.data = null;
    this.diskData = null;
    this.lastHash = null;
    this.remoteChanges.clear();
    this.remoteFolders = [];
  }

  async verifyPassword(password) {
    this._requireUnlocked();
    const check = await deriveKey(password, this.salt, this.kdf);
    const ok = crypto.timingSafeEqual(check, this.key);
    check.fill(0);
    return ok;
  }

  async changeMasterPassword(currentPassword, newPassword) {
    this._requireUnlocked();
    if (!(await this.verifyPassword(currentPassword))) return false;
    this.syncFromDisk(); // pick up any changes from other computers first
    this._requireUnlocked();
    const newSalt = crypto.randomBytes(32);
    const newKdf = { ...KDF };
    const newKey = await deriveKey(newPassword, newSalt, newKdf);
    this.key.fill(0);
    this.salt = newSalt;
    this.kdf = newKdf;
    this.key = newKey;
    this.notifyKey = notifyKeyFrom(newKey);
    this._write();
    return true;
  }

  list() {
    this._requireUnlocked();
    return this.data.entries;
  }

  /** Logins for the window: files are listed by name and size only (their contents stay here until needed). */
  listForDisplay() {
    this._requireUnlocked();
    return this.data.entries.map((e) =>
      e.attachments && e.attachments.length ? { ...e, attachments: e.attachments.map(({ data, ...meta }) => meta) } : e
    );
  }

  /** One attached file, with its contents. */
  attachment(entryId, fileId) {
    this._requireUnlocked();
    const e = this.data.entries.find((x) => x.id === entryId);
    return (e && (e.attachments || []).find((a) => a.id === fileId)) || null;
  }

  upsert(entry) {
    this._requireUnlocked();
    const now = new Date().toISOString();
    const clean = {
      // 'login' (username + password) or 'note' (just a title and notes)
      kind: entry.kind === 'note' ? 'note' : 'login',
      title: String(entry.title || '').trim() || 'Untitled',
      username: String(entry.username || ''),
      password: String(entry.password || ''),
      url: String(entry.url || '').trim(),
      notes: String(entry.notes || ''),
      // Formatted notes (cleaned in the app; `notes` keeps the plain text). Too large → plain text only.
      notesHtml: String(entry.notesHtml || '').length <= MAX_NOTES_HTML ? String(entry.notesHtml || '') : '',
      folder: cleanFolderName(entry.folder),
      icon: cleanIcon(entry.icon),
    };
    let saved;
    if (entry.id) {
      const existing = this.data.entries.find((e) => e.id === entry.id);
      if (!existing) throw new Error('Entry not found.');
      const attachments = cleanAttachments(entry.attachments, existing.attachments, now);
      clean.subsites = cleanSubsites(entry.subsites, existing.subsites);
      saved = { ...existing, ...clean, attachments, updatedAt: now, changedOn: THIS_DEVICE };
    } else {
      const attachments = cleanAttachments(entry.attachments, [], now);
      clean.subsites = cleanSubsites(entry.subsites, []);
      saved = { id: crypto.randomUUID(), ...clean, attachments, createdAt: now, updatedAt: now, changedOn: THIS_DEVICE };
    }
    this.data.entries = [...this.data.entries.filter((e) => e.id !== saved.id), saved];
    if (saved.folder) this._ensureFolder(saved.folder, now);
    this._save();
    return saved;
  }

  remove(id) {
    this._requireUnlocked();
    this.data.entries = this.data.entries.filter((e) => e.id !== id);
    this.data.deleted[id] = new Date().toISOString();
    this._save();
  }

  // ---------- folders ----------
  /** Every folder path: folders you created (even empty ones), any a login is in, and the folders above them. */
  folders() {
    this._requireUnlocked();
    const names = new Set(Object.keys(this.data.folders));
    for (const e of this.data.entries) if (e.folder) names.add(e.folder);
    for (const n of [...names]) for (const a of folderAncestors(n)) names.add(a);
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  /** Make a folder, at the top or inside `parent`. Returns its path. */
  addFolder(name, parent = '') {
    this._requireUnlocked();
    const part = cleanFolderPart(name);
    if (!part) throw new Error('Give the folder a name.');
    const n = cleanFolderName(parent ? `${parent}${FOLDER_SEP}${part}` : part);
    this._ensureFolder(n, new Date().toISOString());
    this._save();
    return n;
  }

  /** Move one login into a folder ('' = no folder). */
  moveToFolder(id, folder) {
    this._requireUnlocked();
    const e = this.data.entries.find((x) => x.id === id);
    if (!e) throw new Error('Entry not found.');
    return this.upsert({ ...e, folder });
  }

  /**
   * Rename or move a folder (give its full new path). Folders and logins inside it go with it.
   * Returns the new path.
   */
  renameFolder(oldName, newName) {
    this._requireUnlocked();
    const to = cleanFolderName(newName);
    if (!to) throw new Error('Give the folder a name.');
    if (to !== oldName && isInside(to, oldName)) throw new Error('A folder can’t go inside itself.');
    if (to === oldName) return to;
    this._moveTree(oldName, to, new Date().toISOString());
    this._save();
    return to;
  }

  /** Move a folder (and everything in it) inside another folder, or to the top ('' ). Returns its new path. */
  moveFolder(name, newParent = '') {
    const last = name.split(FOLDER_SEP).pop();
    return this.renameFolder(name, newParent ? `${newParent}${FOLDER_SEP}${last}` : last);
  }

  /**
   * Delete a folder. Nothing in it is deleted: its logins and folders move up into the folder it was in
   * (or out of folders, for a top-level folder).
   */
  deleteFolder(name) {
    this._requireUnlocked();
    const now = new Date().toISOString();
    const parent = folderParent(name);
    const up = (path) => {
      const rest = path.slice(name.length + 1); // what's below the deleted folder
      return cleanFolderName(parent && rest ? `${parent}${FOLDER_SEP}${rest}` : parent || rest);
    };
    this.data.entries = this.data.entries.map((e) =>
      e.folder && isInside(e.folder, name) ? { ...e, folder: up(e.folder), updatedAt: now, changedOn: THIS_DEVICE } : e
    );
    for (const f of this._pathsInside(name)) {
      delete this.data.folders[f];
      this.data.folderDeleted[f] = now;
      if (f !== name) this._ensureFolder(up(f), now);
    }
    this._save();
  }

  // Every stored or used folder path at or below `name`.
  _pathsInside(name) {
    const all = new Set(Object.keys(this.data.folders).filter((f) => isInside(f, name)));
    for (const e of this.data.entries) if (e.folder && isInside(e.folder, name)) all.add(e.folder);
    all.add(name);
    return [...all];
  }

  // Move folder `from` (and everything below it) to path `to`.
  _moveTree(from, to, now) {
    const moved = (path) => to + path.slice(from.length);
    this.data.entries = this.data.entries.map((e) =>
      e.folder && isInside(e.folder, from) ? { ...e, folder: moved(e.folder), updatedAt: now, changedOn: THIS_DEVICE } : e
    );
    for (const f of this._pathsInside(from)) {
      delete this.data.folders[f];
      this.data.folderDeleted[f] = now;
      this._ensureFolder(moved(f), now);
    }
  }

  _ensureFolder(name, at) {
    if (!name) return;
    if (!this.data.folders[name]) this.data.folders[name] = at;
    delete this.data.folderDeleted[name];
  }

  /** Copy this vault (with its current key) to another file, e.g. when turning sync on or off. */
  writeTo(filePath) {
    this._requireUnlocked();
    this.filePath = filePath;
    this.lastHash = null;
    this._write();
  }

  /** Merge another vault's logins into this one (both must be unlocked). */
  absorb(other) {
    this._requireUnlocked();
    this.data = merge(this.data, other.data);
    this._save();
  }

  /**
   * Re-read the file in case another computer changed it.
   * Returns { changed } or { needsUnlock: true } when the master password was changed elsewhere.
   */
  syncFromDisk() {
    if (!this.isUnlocked() || !this.exists()) return { changed: false };
    let read;
    try {
      read = this._read();
    } catch {
      return { changed: false }; // half-written by the cloud app; try again next time
    }
    if (read.hash === this.lastHash) return { changed: false };
    const remote = this._decryptOther(read.file);
    if (!remote) {
      this.lock();
      return { needsUnlock: true };
    }
    const merged = merge(this.data, remote);
    const changed = !sameData(merged, this.data);
    if (changed) this._noteRemote(this.data, merged);
    this.shared = newerShared(this.shared, decryptShared(this.notifyKey, read.file));
    this.data = merged;
    this.diskData = snapshot(remote);
    this.lastHash = read.hash;
    this.lastSync = new Date();
    if (!sameData(merged, remote)) this._write(); // we had changes the other computer hasn't seen
    return { changed };
  }

  /**
   * Cloud drives sometimes keep both versions when two computers save at once
   * ("vault (conflicted copy).json", "vault-LAPTOP.json", "vault 2.json"...).
   * Merge any such copies we can read, then move them out of the synced folder into local backups.
   */
  mergeConflictCopies() {
    if (!this.isUnlocked()) return false;
    const dir = path.dirname(this.filePath);
    const base = path.basename(this.filePath, '.json');
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return false;
    }
    let changed = false;
    for (const name of names) {
      if (name === path.basename(this.filePath)) continue;
      if (!name.toLowerCase().startsWith(base.toLowerCase()) || !name.toLowerCase().endsWith('.json')) continue;
      const full = path.join(dir, name);
      try {
        const file = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (file.format !== 'password-vault') continue;
        const other = this._decryptOther(file);
        if (!other) continue; // made with a different master password: leave it alone
        const merged = merge(this.data, other);
        if (!sameData(merged, this.data)) {
          changed = true;
          this._noteRemote(this.data, merged);
        }
        this.data = merged;
        fs.mkdirSync(this.backupDir, { recursive: true });
        fs.renameSync(full, path.join(this.backupDir, `conflict-${Date.now()}-${name}`));
      } catch {
        /* unreadable or still syncing: try again later */
      }
    }
    if (changed) this._save();
    return changed;
  }

  getSyncInfo() {
    return { path: this.filePath, lastSync: this.lastSync ? this.lastSync.toISOString() : null };
  }

  _decryptOther(file) {
    try {
      if (file.salt !== this.salt.toString('base64')) return null; // different master password
      return normalize(decrypt(this.key, file.vault));
    } catch {
      return null;
    }
  }

  _requireUnlocked() {
    if (!this.key) throw new Error('Vault is locked.');
  }

  _read() {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    return { raw, file: JSON.parse(raw), hash: sha256(raw) };
  }

  // Save, first merging in anything another computer wrote since we last looked.
  _save() {
    if (this.exists()) {
      const res = this.syncFromDisk();
      if (res.needsUnlock) {
        const err = new Error('Your master password was changed on another computer. Unlock again to continue.');
        err.code = 'PASSWORD_CHANGED_ELSEWHERE';
        throw err;
      }
      if (this.lastHash !== null && this._currentHash() === this.lastHash && !this._dirty()) return;
    }
    this._write();
  }

  _dirty() {
    // Is what we hold in memory different from the file on disk?
    try {
      const remote = this._decryptOther(this._read().file);
      return !remote || !sameData(remote, this.data);
    } catch {
      return true;
    }
  }

  _currentHash() {
    try {
      return sha256(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  /** The change feed to save: what's in the file now, plus what this save changes. */
  _nextFeed() {
    let feed = [];
    try {
      const onDisk = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      feed = decryptFeed(this.notifyKey, onDisk) || [];
      this.shared = newerShared(this.shared, decryptShared(this.notifyKey, onDisk)); // keep another computer's newer settings
    } catch {
      /* no file yet */
    }
    const now = new Date().toISOString();
    for (const c of diffEntries(this.diskData || { entries: [] }, this.data)) {
      feed.push({ id: crypto.randomUUID(), at: now, login: c.id, kind: c.kind, title: c.title, fields: c.fields, changedOn: THIS_DEVICE, device: deviceId });
    }
    const cutoff = new Date(Date.now() - FEED_DAYS * 864e5).toISOString();
    return feed.filter((f) => f.at >= cutoff).slice(-FEED_MAX);
  }

  _write() {
    const file = {
      format: 'password-vault',
      version: 2,
      kdf: this.kdf,
      salt: this.salt.toString('base64'),
      vault: encrypt(this.key, this.data),
      feed: encrypt(this.notifyKey, this._nextFeed()),
    };
    if (this.shared) file.shared = encrypt(this.notifyKey, this.shared);
    const text = JSON.stringify(file, null, 2);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Keep the previous version as a backup on this computer only (not in the synced folder).
    if (this.exists()) {
      try {
        fs.mkdirSync(this.backupDir, { recursive: true });
        fs.copyFileSync(this.filePath, path.join(this.backupDir, 'vault.previous.json'));
      } catch {
        /* backup is best-effort */
      }
    }
    // Atomic write: write a temp file, then rename over the real one.
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    this.lastHash = sha256(text);
    this.diskData = snapshot(this.data);
    this.lastSync = new Date();
  }
}

// Cryptographically secure password generator.
function generatePassword({ length = 20, upper = true, lower = true, digits = true, symbols = true } = {}) {
  const sets = [];
  if (lower) sets.push('abcdefghijkmnopqrstuvwxyz');
  if (upper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
  if (digits) sets.push('23456789');
  if (symbols) sets.push('!@#$%^&*()-_=+[]{};:,.?');
  if (sets.length === 0) sets.push('abcdefghijkmnopqrstuvwxyz');
  length = Math.max(Math.min(Number(length) || 20, 128), sets.length, 4);
  const all = sets.join('');
  // Guarantee at least one char from each chosen set, then fill and shuffle.
  const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
  while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { Vault, generatePassword, merge, diffEntries, notifyKeyFrom, readFeed, readShared, setDeviceId };
