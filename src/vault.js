'use strict';
// Encrypted vault storage.
// - Key derivation: scrypt (N=2^17, r=8, p=1) from the master password + random 32-byte salt.
// - Encryption: AES-256-GCM with a fresh random 12-byte IV on every save (authenticated, tamper-evident).
// - The master password is never stored. Only the derived key is held in memory while unlocked.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KDF = { name: 'scrypt', N: 131072, r: 8, p: 1, keyLen: 32 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

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

class Vault {
  constructor(filePath) {
    this.filePath = filePath;
    this.key = null;
    this.salt = null;
    this.kdf = null;
    this.entries = null;
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
    this.entries = [];
    this._save();
  }

  async unlock(masterPassword) {
    const file = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    const salt = Buffer.from(file.salt, 'base64');
    const key = await deriveKey(masterPassword, salt, file.kdf);
    let entries;
    try {
      entries = decrypt(key, file.vault);
    } catch {
      key.fill(0);
      return false; // wrong password (or tampered file)
    }
    this.salt = salt;
    this.kdf = file.kdf;
    this.key = key;
    this.entries = entries;
    return true;
  }

  lock() {
    if (this.key) this.key.fill(0);
    this.key = null;
    this.entries = null;
  }

  async changeMasterPassword(currentPassword, newPassword) {
    this._requireUnlocked();
    const check = await deriveKey(currentPassword, this.salt, this.kdf);
    const ok = crypto.timingSafeEqual(check, this.key);
    check.fill(0);
    if (!ok) return false;
    const newSalt = crypto.randomBytes(32);
    const newKdf = { ...KDF };
    const newKey = await deriveKey(newPassword, newSalt, newKdf);
    this.key.fill(0);
    this.salt = newSalt;
    this.kdf = newKdf;
    this.key = newKey;
    this._save();
    return true;
  }

  list() {
    this._requireUnlocked();
    return this.entries;
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
    };
    if (entry.id) {
      const idx = this.entries.findIndex((e) => e.id === entry.id);
      if (idx === -1) throw new Error('Entry not found.');
      this.entries[idx] = { ...this.entries[idx], ...clean, updatedAt: now };
      this._save();
      return this.entries[idx];
    }
    const created = { id: crypto.randomUUID(), ...clean, createdAt: now, updatedAt: now };
    this.entries.push(created);
    this._save();
    return created;
  }

  remove(id) {
    this._requireUnlocked();
    this.entries = this.entries.filter((e) => e.id !== id);
    this._save();
  }

  _requireUnlocked() {
    if (!this.key) throw new Error('Vault is locked.');
  }

  _save() {
    const file = {
      format: 'password-vault',
      version: 1,
      kdf: this.kdf,
      salt: this.salt.toString('base64'),
      vault: encrypt(this.key, this.entries),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Atomic write: write to a temp file, keep the previous version as a backup, then rename.
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, this.filePath + '.bak');
    fs.renameSync(tmp, this.filePath);
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

module.exports = { Vault, generatePassword };
