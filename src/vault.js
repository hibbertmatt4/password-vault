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

const cleanFolderName = (name) => String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60);

// Which kind of computer made an edit, so the other computer can say "updated on your Mac".
const THIS_DEVICE = process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows PC' : 'computer';

// What changed between two copies of the vault, login by login: [{ kind: added|updated|deleted, id, title, changedOn }].
function diffEntries(before, after) {
  const old = new Map(normalize(before).entries.map((e) => [e.id, e]));
  const now = new Map(normalize(after).entries.map((e) => [e.id, e]));
  const out = [];
  for (const [id, e] of now) {
    const prev = old.get(id);
    if (!prev) out.push({ kind: 'added', id, title: e.title, changedOn: e.changedOn || null });
    else if ((e.updatedAt || '') !== (prev.updatedAt || '')) out.push({ kind: 'updated', id, title: e.title, changedOn: e.changedOn || null });
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
  }

  /** Changes other computers made since the last call (and forget them). */
  takeRemoteChanges() {
    const list = [...this.remoteChanges.values()];
    this.remoteChanges.clear();
    return list;
  }

  _noteRemote(before, after) {
    for (const c of diffEntries(before, after)) {
      const prev = this.remoteChanges.get(c.id);
      // "added" then "updated" before we reported it is still just "added".
      this.remoteChanges.set(c.id, prev && prev.kind === 'added' && c.kind === 'updated' ? { ...c, kind: 'added' } : c);
    }
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
    this.data = data;
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
    this.data = data;
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
    this.key = null;
    this.data = null;
    this.lastHash = null;
    this.remoteChanges.clear();
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
    this._write();
    return true;
  }

  list() {
    this._requireUnlocked();
    return this.data.entries;
  }

  upsert(entry) {
    this._requireUnlocked();
    const now = new Date().toISOString();
    const clean = {
      title: String(entry.title || '').trim() || 'Untitled',
      username: String(entry.username || ''),
      password: String(entry.password || ''),
      url: String(entry.url || '').trim(),
      notes: String(entry.notes || ''),
      folder: cleanFolderName(entry.folder),
      icon: cleanIcon(entry.icon),
    };
    let saved;
    if (entry.id) {
      const existing = this.data.entries.find((e) => e.id === entry.id);
      if (!existing) throw new Error('Entry not found.');
      saved = { ...existing, ...clean, updatedAt: now, changedOn: THIS_DEVICE };
    } else {
      saved = { id: crypto.randomUUID(), ...clean, createdAt: now, updatedAt: now, changedOn: THIS_DEVICE };
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
  /** Every folder name: folders you created (even empty ones) plus any a login is in. */
  folders() {
    this._requireUnlocked();
    const names = new Set(Object.keys(this.data.folders));
    for (const e of this.data.entries) if (e.folder) names.add(e.folder);
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  addFolder(name) {
    this._requireUnlocked();
    const n = cleanFolderName(name);
    if (!n) throw new Error('Give the folder a name.');
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

  renameFolder(oldName, newName) {
    this._requireUnlocked();
    const to = cleanFolderName(newName);
    if (!to) throw new Error('Give the folder a name.');
    const now = new Date().toISOString();
    this.data.entries = this.data.entries.map((e) => (e.folder === oldName ? { ...e, folder: to, updatedAt: now, changedOn: THIS_DEVICE } : e));
    delete this.data.folders[oldName];
    this.data.folderDeleted[oldName] = now;
    this._ensureFolder(to, now);
    this._save();
    return to;
  }

  /** Delete a folder. Its logins are kept and moved out of the folder. */
  deleteFolder(name) {
    this._requireUnlocked();
    const now = new Date().toISOString();
    this.data.entries = this.data.entries.map((e) => (e.folder === name ? { ...e, folder: '', updatedAt: now, changedOn: THIS_DEVICE } : e));
    delete this.data.folders[name];
    this.data.folderDeleted[name] = now;
    this._save();
  }

  _ensureFolder(name, at) {
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
    this.data = merged;
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

  _write() {
    const file = {
      format: 'password-vault',
      version: 2,
      kdf: this.kdf,
      salt: this.salt.toString('base64'),
      vault: encrypt(this.key, this.data),
    };
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

module.exports = { Vault, generatePassword, merge, diffEntries };
