'use strict';
const { app, BrowserWindow, ipcMain, clipboard, shell, powerMonitor, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { Vault, generatePassword } = require('./vault');
const sync = require('./sync');
const updater = require('./updater');

const AUTO_LOCK_SECONDS = 5 * 60; // lock after 5 minutes of computer inactivity
const CLIPBOARD_CLEAR_MS = 30 * 1000; // wipe copied passwords after 30 seconds
const TITLEBAR_HEIGHT = 40; // must match --titlebar-h in styles.css

let win = null;
let vault = null;
let settings = null;
let localPath = null; // the vault's home when not syncing
let backupDir = null;
let watchedPath = null;
let failedAttempts = 0;
let clipboardTimer = null;

const send = (channel, ...args) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
};

// ---------- where the vault lives / syncing ----------
function openVaultAt(filePath) {
  if (vault) vault.lock();
  vault = new Vault(filePath, backupDir);
  watchVault();
}

// Notice when the cloud drive brings in changes from another computer.
function watchVault() {
  if (watchedPath) fs.unwatchFile(watchedPath);
  watchedPath = vault.filePath;
  fs.watchFile(watchedPath, { interval: 2000 }, () => checkForRemoteChanges());
}

function checkForRemoteChanges() {
  if (!vault || !vault.isUnlocked()) return;
  const res = vault.syncFromDisk();
  if (res.needsUnlock) return send('vault:locked', 'password-changed');
  const merged = vault.mergeConflictCopies();
  if (res.changed || merged) send('vault:changed');
  send('sync:status', syncStatus());
}

// Where the vault is, e.g. "OneDrive". Falls back to the name saved when sync was set up,
// so it still reads right while that cloud drive is offline.
function describeVault() {
  const where = sync.describe(vault.filePath, localPath);
  if (where.synced && !where.provider && settings.get('vaultPlace')) where.name = settings.get('vaultPlace');
  return where;
}

function setVaultPath(p) {
  settings.set('vaultPath', p);
  settings.set('vaultPlace', p ? sync.describe(p, localPath).name : null);
}

function syncStatus() {
  const where = describeVault();
  return { ...where, path: vault.filePath, folder: path.dirname(vault.filePath), lastSync: vault.getSyncInfo().lastSync };
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

// Run a vault action; turn "master password changed on the other computer" into a lock instead of a crash.
function guarded(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.code === 'PASSWORD_CHANGED_ELSEWHERE') {
        vault.lock();
        send('vault:locked', 'password-changed');
        return { ok: false, error: err.message, locked: true };
      }
      throw err;
    }
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 760,
    minHeight: 500,
    title: 'Password Vault',
    backgroundColor: '#f4e0ca',
    // Replace the plain system title bar with the app's own green one.
    // Windows keeps its real minimise / maximise / close buttons, recoloured to match.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { color: '#313d2a', symbolColor: '#f4e0ca', height: TITLEBAR_HEIGHT } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Never navigate away or open new windows inside the app.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function lockVault(reason) {
  if (vault && vault.isUnlocked()) {
    vault.lock();
    if (win && !win.isDestroyed()) win.webContents.send('vault:locked', reason);
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Vault',
      submenu: [
        { label: 'Lock Now', accelerator: 'CmdOrCtrl+L', click: () => lockVault('manual') },
        { label: 'Check for Updatesâ€¦', click: () => updater.check(true) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function registerIpc() {
  ipcMain.handle('vault:status', () => {
    const where = describeVault();
    const exists = vault.exists();
    // A synced vault that can't be found (cloud drive not running / not finished downloading).
    const missing = !exists && where.synced;
    return { exists, unlocked: vault.isUnlocked(), missing, sync: { ...where, path: vault.filePath } };
  });

  // Create a new vault, either on this computer or straight into a cloud folder.
  ipcMain.handle('vault:create', async (_e, password, folder) => {
    if (typeof password !== 'string' || password.length < 8) {
      return { ok: false, error: 'Master password must be at least 8 characters.' };
    }
    if (folder) {
      const existing = sync.findVaultIn(folder);
      if (existing) {
        // Already set up on another computer: use that vault instead of making a second one.
        setVaultPath(existing);
        openVaultAt(existing);
        return { ok: false, existing: true };
      }
      const target = sync.vaultPathIn(folder);
      setVaultPath(target);
      openVaultAt(target);
    } else if (!vault.exists() && !samePath(vault.filePath, localPath)) {
      setVaultPath(null);
      openVaultAt(localPath);
    }
    await vault.create(password);
    return { ok: true };
  });

  ipcMain.handle('sync:providers', () => sync.detectProviders());

  ipcMain.handle('sync:chooseFolder', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a synced folder',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('sync:status', () => syncStatus());

  // Lock screen / first run: point this computer at a vault that already exists in a cloud folder.
  ipcMain.handle('sync:connect', (_e, folder) => {
    const existing = sync.findVaultIn(String(folder));
    if (!existing) return { ok: false, error: 'notFound' };
    setVaultPath(existing);
    openVaultAt(existing);
    return { ok: true, where: sync.describe(existing, localPath) };
  });

  // Settings: start syncing (move this vault into a cloud folder, merging with one already there).
  ipcMain.handle(
    'sync:enable',
    guarded(async (_e, folder, password) => {
      if (!vault.isUnlocked()) return { ok: false, error: 'Unlock your vault first.' };
      if (!(await vault.verifyPassword(String(password || '')))) return { ok: false, error: 'Incorrect master password.' };
      const oldPath = vault.filePath;
      const existing = sync.findVaultIn(String(folder));
      if (existing && samePath(existing, oldPath)) return { ok: true };
      if (existing) {
        const other = new Vault(existing, backupDir);
        if (!(await other.unlock(password))) {
          return {
            ok: false,
            error: 'There is already a Password Vault in that folder with a different master password. Use the same master password on both computers, or choose another folder.',
          };
        }
        other.absorb(vault); // combine both computers' logins into the synced vault
        vault.lock();
        vault = other;
        watchVault();
      } else {
        vault.writeTo(sync.vaultPathIn(String(folder)));
        watchVault();
      }
      setVaultPath(vault.filePath);
      // Keep the old local copy as a backup rather than leaving two live vaults around.
      if (samePath(oldPath, localPath) && fs.existsSync(oldPath)) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.renameSync(oldPath, path.join(backupDir, `vault.before-sync-${Date.now()}.json`));
      }
      send('vault:changed');
      return { ok: true, status: syncStatus() };
    })
  );

  // Settings: stop syncing (keep a copy on this computer only).
  ipcMain.handle(
    'sync:disable',
    guarded(async () => {
      if (!vault.isUnlocked()) return { ok: false, error: 'Unlock your vault first.' };
      if (samePath(vault.filePath, localPath)) return { ok: true, status: syncStatus() };
      vault.syncFromDisk();
      if (fs.existsSync(localPath)) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.renameSync(localPath, path.join(backupDir, `vault.local-${Date.now()}.json`));
      }
      vault.writeTo(localPath);
      setVaultPath(null);
      watchVault();
      return { ok: true, status: syncStatus() };
    })
  );

  // Lock screen: give up on a synced vault that can't be found and start fresh on this computer.
  ipcMain.handle('sync:useLocal', () => {
    setVaultPath(null);
    openVaultAt(localPath);
    return { ok: true };
  });

  ipcMain.handle('sync:showFolder', () => shell.showItemInFolder(vault.filePath));

  ipcMain.handle('vault:unlock', async (_e, password) => {
    if (typeof password !== 'string') return { ok: false, error: 'Invalid password.' };
    // Slow down repeated guessing.
    if (failedAttempts > 2) await sleep(Math.min(1000 * 2 ** (failedAttempts - 3), 30000));
    const ok = await vault.unlock(password);
    if (!ok) {
      failedAttempts++;
      return { ok: false, error: 'Incorrect master password.' };
    }
    failedAttempts = 0;
    checkForRemoteChanges(); // catch anything the other computer saved while we were unlocking
    return { ok: true };
  });

  ipcMain.handle('vault:lock', () => lockVault('manual'));
  ipcMain.handle('vault:list', () => (vault.isUnlocked() ? vault.list() : []));
  ipcMain.handle('vault:save', guarded((_e, entry) => vault.upsert(entry)));
  ipcMain.handle('vault:delete', guarded((_e, id) => vault.remove(id)));

  ipcMain.handle(
    'vault:changeMaster',
    guarded(async (_e, current, next) => {
      if (typeof next !== 'string' || next.length < 8) {
        return { ok: false, error: 'New master password must be at least 8 characters.' };
      }
      const ok = await vault.changeMasterPassword(current, next);
      return ok ? { ok: true } : { ok: false, error: 'Current master password is incorrect.' };
    })
  );

  ipcMain.handle('generate', (_e, opts) => generatePassword(opts));

  // Actions from the app's own Vault / Edit / Window menus.
  const EDIT_ACTIONS = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];
  ipcMain.handle('menu:action', (e, action) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (EDIT_ACTIONS.includes(action)) return e.sender[action]();
    switch (action) {
      case 'lock': return lockVault('manual');
      case 'checkUpdates': return updater.check(true);
      case 'minimize': return w.minimize();
      case 'maximize': return w.isMaximized() ? w.unmaximize() : w.maximize();
      case 'close': return w.close();
      case 'quit': return app.quit();
    }
  });
  ipcMain.handle('window:isMaximized', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return w ? w.isMaximized() : false;
  });

  ipcMain.handle('update:status', () => updater.getStatus());
  ipcMain.handle('update:check', () => updater.check(true));
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => updater.install());

  ipcMain.handle('clipboard:copy', (_e, text) => {
    const value = String(text);
    clipboard.writeText(value);
    clearTimeout(clipboardTimer);
    clipboardTimer = setTimeout(() => {
      if (clipboard.readText() === value) clipboard.clear();
    }, CLIPBOARD_CLEAR_MS);
    return CLIPBOARD_CLEAR_MS / 1000;
  });

  ipcMain.handle('openUrl', (_e, url) => {
    let u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try {
      const parsed = new URL(u);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') shell.openExternal(parsed.href);
    } catch {
      /* ignore invalid URLs */
    }
  });
}

// Only allow one copy of the app to run at once.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // Lets Windows show notifications under the app's own name.
  if (process.platform === 'win32') app.setAppUserModelId('com.matt.passwordvault');

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    localPath = path.join(userData, 'vault.json');
    backupDir = path.join(userData, 'backups');
    settings = new sync.Settings(path.join(userData, 'settings.json'));
    openVaultAt(settings.get('vaultPath') || localPath);
    registerIpc();
    buildMenu();
    createWindow();
    updater.init((status) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
    });
    // Clicking the "update available" notification brings the app to the front.
    app.on('show-window', () => {
      if (!win || win.isDestroyed()) return createWindow();
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });

    // Auto-lock: on inactivity, when the computer locks, or when it goes to sleep.
    setInterval(() => {
      if (powerMonitor.getSystemIdleTime() >= AUTO_LOCK_SECONDS) lockVault('idle');
      checkForRemoteChanges(); // backup in case a file-change notice was missed
    }, 15000);
    powerMonitor.on('lock-screen', () => lockVault('system'));
    powerMonitor.on('suspend', () => lockVault('system'));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    lockVault('closed');
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (watchedPath) fs.unwatchFile(watchedPath);
    lockVault('closed');
    clearTimeout(clipboardTimer);
  });
}
