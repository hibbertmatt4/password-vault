'use strict';
// Finds the cloud-drive folders on this computer (iCloud Drive, OneDrive, Google Drive, Dropbox)
// and remembers where the vault file lives.

const fs = require('fs');
const os = require('os');
const path = require('path');

const VAULT_FOLDER = 'Password Vault'; // created inside the chosen cloud folder
const VAULT_FILE = 'vault.json';

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const listDir = (p) => {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
};

function detectProviders() {
  const home = os.homedir();
  const found = [];
  const add = (id, name, p) => {
    if (p && isDir(p) && !found.some((f) => path.resolve(f.path) === path.resolve(p))) found.push({ id, name, path: p });
  };

  if (process.platform === 'darwin') {
    const cloud = path.join(home, 'Library', 'CloudStorage');
    add('icloud', 'iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
    for (const d of listDir(cloud)) {
      if (d.startsWith('OneDrive')) add('onedrive', d.includes('-') ? `OneDrive (${d.split('-').slice(1).join('-')})` : 'OneDrive', path.join(cloud, d));
      if (d.startsWith('GoogleDrive')) add('gdrive', 'Google Drive', path.join(cloud, d, 'My Drive'));
      if (d.startsWith('Dropbox')) add('dropbox', 'Dropbox', path.join(cloud, d));
    }
    add('dropbox', 'Dropbox', path.join(home, 'Dropbox'));
  } else {
    add('icloud', 'iCloud Drive', path.join(home, 'iCloudDrive'));
    add('onedrive', 'OneDrive', process.env.OneDriveConsumer || process.env.OneDrive);
    if (process.env.OneDriveCommercial) add('onedrive-work', 'OneDrive (work or school)', process.env.OneDriveCommercial);
    add('onedrive', 'OneDrive', path.join(home, 'OneDrive'));
    // Google Drive for desktop shows up as its own drive letter (usually G:) with a "My Drive" folder.
    for (const letter of 'GHIJKLMNOPQRSTUVWXYZDEF') add('gdrive', 'Google Drive', `${letter}:\\My Drive`);
    add('gdrive', 'Google Drive', path.join(home, 'Google Drive'));
    add('gdrive', 'Google Drive', path.join(home, 'My Drive'));
    // Dropbox can be moved; its own settings file says where.
    for (const info of [path.join(process.env.LOCALAPPDATA || '', 'Dropbox', 'info.json'), path.join(process.env.APPDATA || '', 'Dropbox', 'info.json')]) {
      try {
        const data = JSON.parse(fs.readFileSync(info, 'utf8'));
        for (const acct of Object.values(data)) if (acct && acct.path) add('dropbox', 'Dropbox', acct.path);
      } catch {
        /* not installed */
      }
    }
    add('dropbox', 'Dropbox', path.join(home, 'Dropbox'));
  }

  // Used only by the automated tests, never in the installed app.
  if (process.env.PV_TEST_CLOUD_DIR) add('test', 'Test Cloud', process.env.PV_TEST_CLOUD_DIR);
  return found;
}

/** Where the vault file goes inside a chosen folder. Accepts the cloud root or the "Password Vault" folder itself. */
function vaultPathIn(folder) {
  if (path.basename(folder) === VAULT_FOLDER) return path.join(folder, VAULT_FILE);
  return path.join(folder, VAULT_FOLDER, VAULT_FILE);
}

/** If a folder (or its "Password Vault" subfolder) already holds a vault, return that file's path. */
function findVaultIn(folder) {
  for (const p of [vaultPathIn(folder), path.join(folder, VAULT_FILE)]) if (fs.existsSync(p)) return p;
  return null;
}

/** A friendly name for where a vault file lives ("OneDrive", "iCloud Drive", or the folder name). */
function describe(filePath, localPath) {
  if (!filePath || path.resolve(filePath) === path.resolve(localPath)) return { synced: false, name: 'This computer only' };
  for (const p of detectProviders()) {
    const rel = path.relative(p.path, filePath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { synced: true, name: p.name, provider: p.id };
  }
  return { synced: true, name: path.basename(path.dirname(path.dirname(filePath))) || 'a shared folder' };
}

class Settings {
  constructor(file) {
    this.file = file;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = {};
    }
  }
  get(key) {
    return this.data[key];
  }
  set(key, value) {
    if (value === undefined || value === null) delete this.data[key];
    else this.data[key] = value;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { detectProviders, vaultPathIn, findVaultIn, describe, Settings };
