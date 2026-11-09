'use strict';
const { app, BrowserWindow, ipcMain, clipboard, shell, powerMonitor, Menu } = require('electron');
const path = require('path');
const { Vault, generatePassword } = require('./vault');
const updater = require('./updater');

const AUTO_LOCK_SECONDS = 5 * 60; // lock after 5 minutes of computer inactivity
const CLIPBOARD_CLEAR_MS = 30 * 1000; // wipe copied passwords after 30 seconds

let win = null;
let vault = null;
let failedAttempts = 0;
let clipboardTimer = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 760,
    minHeight: 500,
    title: 'Password Vault',
    backgroundColor: '#f4e0ca',
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
        { label: 'Check for Updates…', click: () => updater.check(true) },
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
  ipcMain.handle('vault:status', () => ({ exists: vault.exists(), unlocked: vault.isUnlocked() }));

  ipcMain.handle('vault:create', async (_e, password) => {
    if (typeof password !== 'string' || password.length < 8) {
      return { ok: false, error: 'Master password must be at least 8 characters.' };
    }
    await vault.create(password);
    return { ok: true };
  });

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
    return { ok: true };
  });

  ipcMain.handle('vault:lock', () => lockVault('manual'));
  ipcMain.handle('vault:list', () => vault.list());
  ipcMain.handle('vault:save', (_e, entry) => vault.upsert(entry));
  ipcMain.handle('vault:delete', (_e, id) => vault.remove(id));

  ipcMain.handle('vault:changeMaster', async (_e, current, next) => {
    if (typeof next !== 'string' || next.length < 8) {
      return { ok: false, error: 'New master password must be at least 8 characters.' };
    }
    const ok = await vault.changeMasterPassword(current, next);
    return ok ? { ok: true } : { ok: false, error: 'Current master password is incorrect.' };
  });

  ipcMain.handle('generate', (_e, opts) => generatePassword(opts));

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
    vault = new Vault(path.join(app.getPath('userData'), 'vault.json'));
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
    lockVault('closed');
    clearTimeout(clipboardTimer);
  });
}
