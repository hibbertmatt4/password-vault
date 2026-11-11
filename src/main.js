'use strict';
const { app, BrowserWindow, ipcMain, clipboard, shell, powerMonitor, Menu, dialog, Tray, nativeImage, Notification, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { Vault, generatePassword, readFeed, readShared, setDeviceId } = require('./vault');
const sync = require('./sync');
const biometric = require('./biometric');
const updater = require('./updater');
const reminders = require('./reminders');

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

// ---------- iCloud Drive on a Mac ----------
// iCloud brings a file changed on another computer down lazily: until something looks at the folder (like opening it
// in Finder), the Mac can keep showing the old vault. So while the vault is in iCloud Drive, ask for the latest copy
// ourselves, regularly, and when the window opens or you press "Sync now".
const inICloud = () => process.platform === 'darwin' && !!vault && /\/Library\/Mobile Documents\//.test(vault.filePath);
let brctlLogged = false;
function nudgeICloud() {
  if (!inICloud()) return;
  const file = vault.filePath;
  try {
    // looking at the folder is what makes iCloud refresh it
    const dir = path.dirname(file);
    for (const name of fs.readdirSync(dir)) {
      try {
        fs.statSync(path.join(dir, name));
      } catch {
        /* still arriving */
      }
    }
  } catch {
    /* no access yet */
  }
  // and ask for the newest copy of the vault file itself
  require('child_process').execFile('/usr/bin/brctl', ['download', file], { timeout: 15000 }, (err, _out, stderr) => {
    if (err && !brctlLogged) {
      brctlLogged = true;
      syncLog(`iCloud: asking for the latest copy didn't work: ${String(stderr || err.message).trim().slice(0, 200)}`);
    }
  });
}

function checkForRemoteChanges() {
  if (!vault) return;
  if (!vault.isUnlocked()) return checkWhileLocked();
  const res = vault.syncFromDisk();
  if (res.needsUnlock) return send('vault:locked', 'password-changed');
  const merged = vault.mergeConflictCopies();
  if (res.changed || merged) send('vault:changed');
  rememberNotifyKey();
  followShared(vault.shared);
  shareReminders();
  reportRemoteChanges();
  markFeedSeen(); // everything in the change list has now been reported (or was made here)
  send('sync:status', syncStatus());
}

// ---------- telling you when another computer adds, changes or deletes a password ----------
// Always a system notification (Windows / Mac notification centre), whether the window is open,
// closed to the tray / menu bar, or the vault is locked. Only a fully quit app can't notify.
const THIS_DEVICE = process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows PC' : 'computer';
const GENERIC_NOTICE_GAP_MS = 10 * 60 * 1000;
let changeNotification = null; // keep a reference so Windows doesn't drop the click handler
let notifyKey = null; // reads the vault's change list while locked (never passwords)
const seenFeed = new Set(); // change-list items already handled
let lastGenericNotice = 0;

const notifyKeyFile = () => path.join(app.getPath('userData'), 'notify-key.json');

// Which notifications to show (Settings → Notifications). Kept per computer; when this computer is set to
// "All my computers", it follows (and publishes) the choices stored, encrypted, in the synced vault file.
const NOTIFY_KINDS = ['added', 'updated', 'deleted', 'updates'];
const DEFAULT_NOTIFY = { added: true, updated: true, deleted: true, updates: true };
const notifyPrefs = () => ({ ...DEFAULT_NOTIFY, ...(settings.get('notify') || {}) });
const notifyScope = () => (settings.get('notifyScope') === 'device' ? 'device' : 'all');
const isSynced = () => !!vault && !samePath(vault.filePath, localPath);
const cleanNotify = (n) => Object.fromEntries(NOTIFY_KINDS.map((k) => [k, n[k] !== false]));

function notifyState() {
  return { prefs: notifyPrefs(), scope: notifyScope(), synced: isSynced() };
}

// Another computer changed the shared choices: take them on, unless this computer keeps its own.
function followShared(shared) {
  if (!shared || !shared.notify || notifyScope() !== 'all' || !isSynced()) return;
  if (shared.updatedAt <= (settings.get('notifySharedAt') || '')) return;
  settings.set('notify', cleanNotify(shared.notify));
  settings.set('notifySharedAt', shared.updatedAt);
  send('notify:changed', notifyState());
}

// This computer's choices become everyone's (only while unlocked: the vault file has to be saved).
function publishShared() {
  if (notifyScope() !== 'all' || !isSynced() || !vault.isUnlocked()) return;
  const shared = vault.setShared({ notify: notifyPrefs() });
  settings.set('notifySharedAt', shared.updatedAt);
}

// ---------- reminders shared between computers ----------
// Reminders live on each computer (so they fire while locked), and also in the synced vault file (encrypted with
// the notify key, so a locked computer can read them too). Anything made on one computer reaches the others.
function pullReminders(shared) {
  if (shared && shared.reminders && reminders.importState(shared.reminders)) send('reminders:changed');
}
function pushReminders() {
  if (!vault || !isSynced() || !vault.isUnlocked()) return; // (anything pending goes in when the vault is next unlocked)
  try {
    vault.setSharedReminders(reminders.exportState());
  } catch (err) {
    syncLog(`could not save reminders to the synced vault: ${err && err.message}`);
  }
}
function shareReminders() {
  if (!vault || !isSynced() || !vault.isUnlocked()) return;
  pullReminders(vault.shared);
  pushReminders();
}

// Keep the notify key sealed by the operating system (Keychain / Windows protected storage),
// so notifications can name the changed login even after the app restarts locked.
function rememberNotifyKey() {
  if (!vault.notifyKey || (notifyKey && notifyKey.equals(vault.notifyKey))) return;
  notifyKey = Buffer.from(vault.notifyKey);
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const sealed = safeStorage.encryptString(notifyKey.toString('base64')).toString('base64');
    fs.writeFileSync(notifyKeyFile(), JSON.stringify({ sealed }), { mode: 0o600 });
  } catch {
    /* notifications fall back to a general notice while locked */
  }
}

function loadNotifyKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const { sealed } = JSON.parse(fs.readFileSync(notifyKeyFile(), 'utf8'));
    notifyKey = Buffer.from(safeStorage.decryptString(Buffer.from(sealed, 'base64')), 'base64');
  } catch {
    notifyKey = null;
  }
}

const readChangeList = () => (notifyKey && vault ? readFeed(vault.filePath, notifyKey) : null);

function markFeedSeen() {
  const feed = readChangeList();
  if (!feed) return;
  for (const f of feed) seenFeed.add(f.id);
  const newest = feed.reduce((m, f) => (f.at > m ? f.at : m), '');
  if (newest && newest > (settings.get('feedSeenUntil') || '')) settings.set('feedSeenUntil', newest);
}

// Several entries for one login (e.g. added, then edited) become one.
function collapse(items) {
  const byLogin = new Map();
  for (const f of items) {
    const prev = byLogin.get(f.login);
    if (prev && prev.kind === 'added' && f.kind === 'updated') byLogin.set(f.login, { ...f, kind: 'added', fields: undefined });
    else if (prev && prev.kind === 'updated' && f.kind === 'updated') byLogin.set(f.login, { ...f, fields: [...new Set([...(prev.fields || []), ...(f.fields || [])])] });
    else byLogin.set(f.login, f);
  }
  return [...byLogin.values()];
}

// A small log of change checks (Password Vault's data folder → logs/sync.log), so a missed notification
// can be diagnosed. Counts and outcomes only — never login names or anything from the vault.
function syncLog(text) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    const file = path.join(dir, 'sync.log');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, `${new Date().toISOString()} v${app.getVersion()} ${text}\n`);
  } catch {
    /* logging must never get in the way */
  }
}

// New items in the change list made by other computers. `since` (a time) is used once at start-up,
// to report what changed while this computer was off.
function takeNewFeedItems(since) {
  const feed = readChangeList();
  if (!feed) return null;
  const fresh = feed.filter((f) => !seenFeed.has(f.id));
  fresh.forEach((f) => seenFeed.add(f.id));
  markFeedSeen();
  const mine = settings.get('deviceId');
  return collapse(fresh.filter((f) => f.device !== mine && (!since || f.at > since)));
}

const placeOf = (device) => (!device ? 'on another computer' : device === THIS_DEVICE ? `on your other ${device}` : `on your ${device}`);

function listNames(names) {
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

// "icon", "password and username", "name, website and notes"
const FIELD_NAMES = { title: 'name', username: 'username', password: 'password', url: 'website', notes: 'notes', notesHtml: 'notes', attachments: 'files', subsites: 'subsites', icon: 'icon', folder: 'folder' };
function fieldList(fields) {
  const names = [...new Set((fields || []).map((f) => FIELD_NAMES[f]).filter(Boolean))];
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// e.g. { title: 'Password updated on your Mac', body: 'GitHub — icon changed', short: 'GitHub: icon changed on your Mac' }
function describeRemoteChanges(list) {
  const devices = new Set(list.map((c) => c.changedOn).filter(Boolean));
  const place = placeOf(devices.size === 1 ? [...devices][0] : null);
  if (list.length === 1) {
    const c = list[0];
    const what = c.kind === 'updated' ? fieldList(c.fields) : '';
    return {
      title: `Password ${c.kind} ${place}`,
      body: what ? `${c.title} — ${what} changed` : c.title,
      short: what ? `${c.title}: ${what} changed ${place}` : `${c.title} was ${c.kind} ${place}`,
    };
  }
  const parts = [];
  for (const [kind, label] of [['added', 'Added'], ['updated', 'Updated'], ['deleted', 'Deleted']]) {
    const names = list.filter((c) => c.kind === kind).map((c) => c.title);
    if (names.length) parts.push(`${label}: ${listNames(names)}.`);
  }
  return { title: `${list.length} passwords changed ${place}`, body: parts.join(' '), short: `${list.length} passwords changed ${place}` };
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  changeNotification = new Notification({ title, body });
  changeNotification.on('click', showWindow);
  changeNotification.show();
}

function reportChanges(list, how) {
  const all = list || [];
  const wanted = notifyPrefs();
  list = all.filter((c) => wanted[c.kind]);
  if (all.length) syncLog(`${how}: ${all.length} change(s) from another computer, ${list.length} notified`);
  if (!list.length) return;
  const msg = describeRemoteChanges(list);
  notify(msg.title, msg.body);
}

// Unlocked: the vault itself says exactly what came in from the other computer.
// Also shown as a message inside the app (any change, including icons and folders).
function reportRemoteChanges() {
  const list = vault.takeRemoteChanges();
  const folders = vault.takeRemoteFolderChanges();
  if (list.length) send('sync:remoteChanges', describeRemoteChanges(list).short);
  else if (folders.length) {
    const f = folders[0];
    const what = folders.length === 1 ? `Folder “${f.name.split('/').join(' › ')}” was ${f.kind === 'added' ? 'added' : 'removed'}` : 'Your folders were changed';
    send('sync:remoteChanges', `${what} ${placeOf(null)}`);
  }
  reportChanges(list, 'unlocked');
}

// Locked (window closed, or started at sign-in): read the change list with the notify key.
function checkWhileLocked() {
  if (samePath(vault.filePath, localPath)) return; // only synced vaults change from elsewhere
  const now = vault.fileHash();
  if (!now) return;
  if (!vault.seenHash) {
    vault.seenHash = now; // first look since the app started
    return;
  }
  if (now === vault.seenHash) return;
  vault.seenHash = now;
  if (notifyKey) {
    const shared = readShared(vault.filePath, notifyKey);
    followShared(shared);
    pullReminders(shared); // reminders made on another computer start working here even while locked
  }
  const items = takeNewFeedItems();
  if (items) {
    if (!items.length) syncLog('locked: file changed, nothing new from other computers');
    return reportChanges(items, 'locked');
  }
  // No readable change list (vault not unlocked on this computer since installing this version,
  // the master password was changed elsewhere, or the other computer runs an older version).
  syncLog(`locked: file changed, change list not readable (${notifyKey ? 'key does not fit' : 'no key yet: unlock once'})`);
  const p = notifyPrefs();
  if (!(p.added || p.updated || p.deleted) || Date.now() - lastGenericNotice < GENERIC_NOTICE_GAP_MS) return;
  lastGenericNotice = Date.now();
  notify('Your passwords were changed on another computer', 'Open Password Vault and unlock it to see what’s new.');
}

// At start-up: report what other computers changed while this one was off, then keep watching.
function catchUpOnStart() {
  if (!vault || samePath(vault.filePath, localPath)) return;
  if (notifyKey) {
    const shared = readShared(vault.filePath, notifyKey);
    followShared(shared);
    pullReminders(shared);
  }
  const since = settings.get('feedSeenUntil');
  const items = takeNewFeedItems(since || '9999'); // first run with this feature: just remember what's there
  vault.seenHash = vault.fileHash();
  syncLog(`start-up: ${notifyKey ? 'change-list key ready' : 'no change-list key yet'}, ${items ? items.length : 'unreadable'} change(s) while off`);
  reportChanges(items, 'start-up');
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

// ---------- running in the background (tray / menu bar) & starting at sign-in ----------
let tray = null;
let windowCreatedBefore = false;
let quitting = false; // true once the user really quits (tray "Quit", Cmd+Q, installing an update)
// Started by "open at sign-in": stay hidden in the tray until the user opens it.
let startedHidden =
  process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);

const prefs = () => ({
  keepRunning: settings.get('keepRunning') !== false, // on unless turned off
  openAtLogin: settings.get('openAtLogin') !== false,
  autoInstall: settings.get('autoInstall') !== false, // install a downloaded update while the window is closed
  // how long a shown password / hidden part of a note stays shown (seconds; 0 = until hidden by hand)
  revealSeconds: Number.isInteger(settings.get('revealSeconds')) ? settings.get('revealSeconds') : 30,
});

// ---------- text size (zoom): Ctrl / ⌘ and + - 0, or Settings → Text size ----------
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
const zoomFactor = () => {
  const z = settings && settings.get('zoomFactor');
  return typeof z === 'number' && z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 1;
};
// Applies the zoom to the page. (The green title bar is drawn by the page at a constant real size, whatever the
// zoom, so the window's own buttons, which don't zoom, always line up with it.)
function applyZoom() {
  if (!win || win.isDestroyed()) return;
  const z = zoomFactor();
  win.webContents.setZoomFactor(z);
  // Zoomed in, the page needs more room: the smallest the window can be grows with it (and shrinks a little when zoomed out).
  win.setMinimumSize(Math.round(Math.min(1400, Math.max(560, 760 * z))), Math.round(Math.min(900, Math.max(400, 500 * z))));
  send('zoom:changed', z);
}
function setZoom(value) {
  const z = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(value) || 1)) * 100) / 100;
  settings.set('zoomFactor', z === 1 ? null : z);
  applyZoom();
  return z;
}
const stepZoom = (dir) => setZoom(zoomFactor() + dir * ZOOM_STEP);

// Close the window into the tray / menu bar: the vault locks, the app keeps running (updates, reminders).
// On a Mac, once the window is hidden Password Vault has no Dock icon (so it doesn't look like it's still open
// with the little dot under it); only its menu bar icon is left, which is where it keeps checking for updates and
// sending notifications. Opening it again brings the Dock icon back.
function dockAway() {
  if (process.platform === 'darwin' && tray && app.dock) app.dock.hide();
}

function hideToTray() {
  if (win && !win.isDestroyed()) {
    if (process.platform === 'darwin' && win.isFullScreen()) {
      // Hiding a Mac window that's in full screen leaves its empty black full-screen space behind, so leave
      // full screen first (it takes a moment) and hide once that's done.
      const w = win;
      let done = false;
      const hideNow = () => {
        if (done || w.isDestroyed()) return;
        done = true;
        w.hide();
        dockAway();
      };
      w.once('leave-full-screen', () => setTimeout(hideNow, 50));
      setTimeout(hideNow, 1500); // in case that never arrives
      w.setFullScreen(false);
    } else {
      win.hide();
      dockAway();
    }
  }
  lockVault('closed');
  firstHideHint();
}

// Quit from the app's own menu. On a Mac, ⌘Q (and Vault ▸ Quit) behave like closing the window, so
// Password Vault stays in the menu bar and keeps checking for updates; the menu bar icon's Quit really quits.
async function quitFromMenu() {
  if (process.platform === 'darwin' && tray && prefs().keepRunning) return flushWork().then(hideToTray);
  await flushWork();
  quitting = true;
  app.quit();
}

// Before the app closes or restarts on purpose (quit, closing the window, installing an update), ask the page to
// save any login or note that's half-written, and wait for its answer (a few seconds at most). Returns what the
// page said ({ saved, title }) or null.
function flushWork(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed() || !win.isVisible() || !vault || !vault.isUnlocked()) return resolve(null);
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      ipcMain.removeListener('app:flushed', onAnswer);
      clearTimeout(timer);
      if (result && result.saved) settings.set('savedNotice', `Saved “${result.title || 'your unfinished entry'}” for you before closing.`);
      resolve(result || null);
    };
    const onAnswer = (_e, result) => finish(result);
    const timer = setTimeout(() => finish(null), timeoutMs);
    ipcMain.on('app:flushed', onAnswer);
    win.webContents.send('app:flush');
  });
}

// A user-chosen "Restart to update" (saves unfinished work first).
async function restartToUpdate() {
  await flushWork();
  updater.install();
}

// A downloaded update installs by itself once nobody is using the app (window closed into the tray, so the vault
// is locked and nothing can be lost), then the app starts again, still in the tray.
function maybeAutoInstall() {
  if (quitting || updater.getStatus().state !== 'downloaded' || !prefs().autoInstall) return;
  if (win && !win.isDestroyed() && (win.isVisible() || win.isMinimized())) return;
  updater.install({ auto: true });
}

function showWindow() {
  if (process.platform === 'darwin' && app.dock) app.dock.show(); // (the Dock icon comes back with the window)
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function trayImage() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function rebuildTrayMenu() {
  if (!tray) return;
  const up = updater.getStatus();
  const updateItem =
    up.state === 'downloaded'
      ? { label: `Restart to update to ${up.version}`, click: () => restartToUpdate() }
      : up.state === 'available'
        ? { label: `Update available (${up.version})…`, click: () => showWindow() }
        : {
            label: 'Check for updates',
            click: () => {
              showWindow();
              updater.check(true);
            },
          };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Password Vault', click: showWindow },
      { label: 'Lock now', enabled: !!(vault && vault.isUnlocked()), click: () => lockVault('manual') },
      { type: 'separator' },
      updateItem,
      { type: 'separator' },
      {
        label: 'Quit Password Vault',
        click: async () => {
          await flushWork();
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.setToolTip(up.state === 'available' || up.state === 'downloaded' ? `Password Vault — update ${up.version} available` : 'Password Vault');
}

function applyBackgroundPrefs() {
  const p = prefs();
  if (p.keepRunning && !tray) {
    tray = new Tray(trayImage());
    // Windows: click the tray icon to open the app (right-click for the menu).
    // Mac: clicking the menu bar icon shows the menu, as Mac users expect.
    if (process.platform !== 'darwin') {
      tray.on('click', showWindow);
      tray.on('double-click', showWindow);
    }
    rebuildTrayMenu();
  } else if (!p.keepRunning && tray) {
    tray.destroy();
    tray = null;
  }
  // Only the installed app registers itself to start at sign-in (never a development copy).
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: p.openAtLogin && p.keepRunning,
      openAsHidden: true, // older macOS
      args: ['--hidden'], // Windows: start hidden in the tray
    });
  }
}

// The first time the window is closed into the tray, explain where the app went.
let hintNotification = null;
function firstHideHint() {
  if (settings.get('trayHintShown') || !Notification.isSupported()) return;
  settings.set('trayHintShown', true);
  hintNotification = new Notification({
    title: 'Password Vault is still running',
    body:
      process.platform === 'darwin'
        ? 'Your vault is locked. Find Password Vault in the menu bar at the top of the screen to open it or quit — it keeps checking for updates.'
        : 'Your vault is locked. Find Password Vault in the system tray (by the clock) to open it or quit — it keeps checking for updates.',
  });
  hintNotification.on('click', showWindow);
  hintNotification.show();
}

function createWindow() {
  win = new BrowserWindow({
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '..', 'build', 'icon.png') }), // run from source: still the app's logo
    show: !(startedHidden && !windowCreatedBefore), // the first window stays hidden when started at sign-in
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
      // Windows draws its button strip with its own rounding, which at some display scalings
      // (e.g. 150%) came out 1 pixel taller than our bar and stuck out underneath. Making the strip
      // a pixel shorter keeps it fully inside the green bar at every scaling.
      : { titleBarOverlay: { color: '#313d2a', symbolColor: '#f4e0ca', height: TITLEBAR_HEIGHT - 1 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Spell check is on for the notes and reminder boxes only (every other field turns it off in the page).
      // It uses the computer's own spell checker (Windows / macOS), so nothing is sent anywhere.
      spellcheck: true,
    },
  });
  spellingMenu(win.webContents);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  windowCreatedBefore = true;

  // Never navigate away or open new windows inside the app.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Closing the window keeps Password Vault running in the tray / menu bar (vault locked),
  // so it can keep checking for updates and send notifications.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    // (an unfinished login / note is saved first: closing locks the vault, or quits)
    flushWork().then(() => {
      if (prefs().keepRunning) return hideToTray();
      quitting = true;
      app.quit();
    });
  });
  win.on('hide', () => setTimeout(maybeAutoInstall, 1500));
  win.on('show', () => {
    win.webContents.send('window:shown');
    updater.checkSoon(2000);
    if (inICloud()) {
      nudgeICloud(); // opening the window: make sure it's showing what the other computer saved
      setTimeout(checkForRemoteChanges, 3000);
    }
  });
  win.on('focus', () => updater.checkSoon(2000));
  // Mac hides the traffic lights in full screen, so the title bar can use that space.
  const sendFullScreen = () => send('window:fullscreen', win.isFullScreen());
  win.on('enter-full-screen', sendFullScreen);
  win.on('leave-full-screen', sendFullScreen);
  win.webContents.on('did-finish-load', () => {
    sendFullScreen();
    applyZoom();
  });
  // Ctrl / ⌘ with + (or =), - and 0: bigger, smaller, back to normal.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mac = process.platform === 'darwin';
    const key = String(input.key);
    // Full screen: F11 on Windows, Control + ⌘ + F on a Mac.
    if ((!mac && key === 'F11') || (mac && input.control && input.meta && key.toLowerCase() === 'f')) {
      win.setFullScreen(!win.isFullScreen());
      return e.preventDefault();
    }
    if (input.alt || !(mac ? input.meta : input.control)) return;
    // Minimise: Ctrl / ⌘ + M. Maximise (or back to normal): Ctrl / ⌘ + Shift + M.
    if (key.toLowerCase() === 'm') {
      if (input.shift) win.isMaximized() ? win.unmaximize() : win.maximize();
      else win.minimize();
      return e.preventDefault();
    }
    // Zoom: Ctrl / ⌘ with + (or =), - and 0.
    if (key === '+' || key === '=') stepZoom(1);
    else if (key === '-' || key === '_') stepZoom(-1);
    else if (key === '0') setZoom(1);
    else return;
    e.preventDefault();
  });
}

// Decrypted copies of files opened from logins live here, and are deleted when the vault locks or the app quits.
const openedFilesDir = () => path.join(app.getPath('temp'), 'Password Vault open files');
function clearOpenedFiles() {
  try {
    fs.rmSync(openedFilesDir(), { recursive: true, force: true });
  } catch {
    /* a file still open in another app is removed next time */
  }
}

// Right-click in a text box: spelling suggestions for an underlined word, plus Cut / Copy / Paste.
let notesContext = null; // set by the page just before the menu opens, when the right-click was in the notes box
ipcMain.on('notes:ctx', (e, state) => {
  notesContext = { ...(state || {}), at: Date.now() };
  e.returnValue = true;
});

function spellingMenu(contents) {
  contents.on('context-menu', (_e, p) => {
    if (!p.isEditable) return;
    const hide = notesContext && Date.now() - notesContext.at < 1500 && notesContext.canHide ? notesContext : null;
    notesContext = null;
    // The menu is drawn by the page itself, in the app's own style (see onEditMenu in app.js).
    if (!contents.isDestroyed()) {
      contents.send('edit:menu', {
        word: p.misspelledWord || '',
        suggestions: (p.dictionarySuggestions || []).slice(0, 5),
        flags: { canCut: !!p.editFlags.canCut, canCopy: !!p.editFlags.canCopy, canPaste: !!p.editFlags.canPaste },
        hide: hide ? { unhide: !!hide.unhide } : null,
      });
    }
  });
}
// The page's spelling choices: replace the word that was right-clicked, or add it to the dictionary.
ipcMain.handle('spell:replace', (e, word) => {
  e.sender.replaceMisspelling(String(word));
});
ipcMain.handle('spell:add', (e, word) => {
  e.sender.session.addWordToSpellCheckerDictionary(String(word));
});

function lockVault(reason) {
  if (vault && vault.isUnlocked()) {
    syncLog(`vault locked (${reason}); watching for changes: ${isSynced() ? 'yes' : 'no (not synced)'}, change-list key: ${notifyKey ? 'yes' : 'no'}`);
    vault.lock();
    if (win && !win.isDestroyed()) win.webContents.send('vault:locked', reason);
  }
  clearOpenedFiles();
  rebuildTrayMenu();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { label: 'Quit Password Vault', accelerator: 'Cmd+Q', click: quitFromMenu },
            ],
          },
        ]
      : []),
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
    {
      // (the shortcuts themselves are handled in createWindow, so they're only shown here)
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', registerAccelerator: false, click: () => stepZoom(1) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', registerAccelerator: false, click: () => stepZoom(-1) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', registerAccelerator: false, click: () => setZoom(1) },
      ],
    },
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
    guarded(async (_e, folder, password, useBiometric, folderPassword) => {
      if (!vault.isUnlocked()) return { ok: false, error: 'Unlock your vault first.' };
      const who = await confirmIdentity(password, useBiometric, 'turn on sync for Password Vault');
      if (!who.ok) return who;
      const oldPath = vault.filePath;
      const existing = sync.findVaultIn(String(folder));
      if (existing && samePath(existing, oldPath)) return { ok: true };
      let passwordChanged = false;
      if (existing) {
        const other = new Vault(existing, backupDir);
        let opened = useBiometric ? other.unlockWithKey(vault.keyInfo().key) : await other.unlock(password);
        if (!opened) {
          if (useBiometric) {
            // A vault from another computer is already there; combining them needs the typed password.
            return { ok: false, needsPassword: true, error: 'There’s already a vault in that folder. Type your master password to combine the two.' };
          }
          // That folder's vault uses a different master password. Joining it means this computer
          // switches to that password, so the user has to type it (and is told so first).
          if (typeof folderPassword !== 'string' || !folderPassword) return { ok: false, differentPassword: true };
          if (failedAttempts > 2) await sleep(Math.min(1000 * 2 ** (failedAttempts - 3), 30000));
          opened = await other.unlock(folderPassword);
          if (!opened) {
            failedAttempts++;
            return { ok: false, differentPassword: true, error: 'That isn’t the master password for the vault in that folder.' };
          }
          failedAttempts = 0;
          passwordChanged = true;
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
      biometric.refresh(vault.keyInfo()); // vault moved: Touch ID / Hello follows it
      rememberNotifyKey();
      shareReminders(); // this computer's reminders join the ones in the synced vault, and the other way round
      if (passwordChanged) syncLog('joined a synced vault with a different master password');
      return { ok: true, passwordChanged, status: syncStatus() };
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
      biometric.refresh(vault.keyInfo());
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
  // "Sync now": fetch the newest copy (iCloud), then merge whatever is there.
  ipcMain.handle('sync:now', async () => {
    nudgeICloud();
    await sleep(inICloud() ? 3000 : 200);
    checkForRemoteChanges();
    return syncStatus();
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
    checkForRemoteChanges(); // catch anything the other computer saved while we were unlocking
    shareReminders(); // (also covers a vault that isn't synced yet: nothing happens then)
    biometric.refresh(vault.keyInfo()); // master password used: restart the Touch ID / Hello 7-day clock
    rebuildTrayMenu();
    return { ok: true };
  });

  // ---------- Touch ID / Windows Hello ----------
  // "Confirm it's you" for any step that asks for the master password (except changing it, and
  // turning Touch ID / Hello on): either the typed master password or Touch ID / Windows Hello.
  async function confirmIdentity(password, useBiometric, reason) {
    if (!useBiometric) {
      return (await vault.verifyPassword(String(password || ''))) ? { ok: true } : { ok: false, error: 'Incorrect master password.' };
    }
    const st = await biometric.status(bioVaultInfo());
    if (!st.enabled || !st.available || st.needsPassword) {
      return { ok: false, needsPassword: true, error: `Type your master password this time (${biometric.name()} needs it once a week, or after it changes).` };
    }
    const res = await biometric.unlockKey(reason);
    if (res.error === 'cancelled') return { ok: false, cancelled: true };
    if (res.error) return { ok: false, needsPassword: true, error: 'Type your master password to continue.' };
    const current = vault.keyInfo();
    const matches = res.key.length === current.key.length && require('crypto').timingSafeEqual(res.key, current.key);
    res.key.fill(0);
    current.key.fill(0);
    return matches ? { ok: true } : { ok: false, needsPassword: true, error: 'Type your master password to continue.' };
  }

  const bioVaultInfo = () => ({ filePath: vault.filePath, salt: vault.isUnlocked() ? vault.keyInfo().salt : vault.fileSalt() });

  ipcMain.handle('bio:status', () => biometric.status(vault.exists() ? bioVaultInfo() : null));

  // Turn on: confirm the master password, then a fingerprint/face so we know it works.
  ipcMain.handle('bio:enable', async (_e, password) => {
    if (!vault.isUnlocked()) return { ok: false, error: 'Unlock your vault first.' };
    if (!(await vault.verifyPassword(String(password || '')))) return { ok: false, error: 'Incorrect master password.' };
    const st = await biometric.status(null);
    if (!st.available) return { ok: false, error: `${biometric.name()} isn't set up on this computer.` };
    if (!(await biometric.prompt(`turn on ${biometric.name()} for Password Vault`))) {
      return { ok: false, error: `${biometric.name()} didn't confirm it was you. Nothing was changed.` };
    }
    biometric.saveKey(vault.keyInfo());
    return { ok: true };
  });

  ipcMain.handle('bio:disable', () => {
    biometric.disable();
    return { ok: true };
  });

  ipcMain.handle('bio:unlock', async () => {
    if (!vault.exists()) return { ok: false, error: 'No vault found.' };
    const res = await biometric.unlockKey('unlock Password Vault');
    if (res.error === 'cancelled') return { ok: false, cancelled: true };
    if (res.error === 'expired') return { ok: false, needsPassword: true, error: `For your security, enter your master password (required every ${biometric.RECHECK_DAYS} days).` };
    if (res.error) return { ok: false, needsPassword: true, error: 'Enter your master password to continue.' };
    if (res.filePath !== vault.filePath || !vault.unlockWithKey(res.key)) {
      res.key.fill(0);
      return { ok: false, needsPassword: true, error: 'Your master password has changed. Enter it once to keep using ' + biometric.name() + '.' };
    }
    res.key.fill(0);
    failedAttempts = 0;
    checkForRemoteChanges();
    shareReminders();
    rebuildTrayMenu();
    return { ok: true };
  });

  ipcMain.handle('vault:lock', () => lockVault('manual'));
  ipcMain.handle('vault:list', () => (vault.isUnlocked() ? vault.listForDisplay() : []));
  const forDisplay = (id) => vault.listForDisplay().find((e) => e.id === id);
  ipcMain.handle(
    'vault:save',
    guarded((_e, entry) => {
      try {
        const saved = vault.upsert(entry);
        reminders.loginChanged(saved.id, saved.title);
        return forDisplay(saved.id);
      } catch (err) {
        if (err.code === 'PASSWORD_CHANGED_ELSEWHERE') throw err;
        return { ok: false, error: err.message };
      }
    })
  );

  // ---------- files attached to logins, and pictures in notes ----------
  // Opening a file needs a decrypted copy on disk: it goes in a private temporary folder that is emptied
  // when the vault locks and when Password Vault quits. Only everyday document and picture types can be
  // opened from here; anything else (e.g. programs) can only be saved somewhere you choose.
  const OPENABLE = /\.(pdf|txt|csv|md|rtf|png|jpe?g|gif|webp|bmp|heic|tiff?|docx?|xlsx?|pptx?|odt|ods|odp|pages|numbers|key)$/i;
  ipcMain.handle('file:save', async (_e, entryId, fileId) => {
    if (!vault.isUnlocked()) return { ok: false, locked: true };
    const a = vault.attachment(String(entryId), String(fileId));
    if (!a) return { ok: false, error: 'That file is no longer there.' };
    const res = await dialog.showSaveDialog(win, { title: 'Save file', defaultPath: path.join(app.getPath('downloads'), a.name) });
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    fs.writeFileSync(res.filePath, Buffer.from(a.data, 'base64'));
    return { ok: true, path: res.filePath };
  });
  // The contents, for the preview inside the app (nothing is written to disk).
  ipcMain.handle('file:get', (_e, entryId, fileId) => {
    if (!vault.isUnlocked()) return { ok: false, locked: true };
    const a = vault.attachment(String(entryId), String(fileId));
    if (!a) return { ok: false, error: 'That file is no longer there.' };
    return { ok: true, name: a.name, type: a.type, size: a.size, data: a.data };
  });
  ipcMain.handle('file:open', async (_e, entryId, fileId) => {
    if (!vault.isUnlocked()) return { ok: false, locked: true };
    const a = vault.attachment(String(entryId), String(fileId));
    if (!a) return { ok: false, error: 'That file is no longer there.' };
    if (!OPENABLE.test(a.name)) return { ok: false, notOpenable: true };
    const dir = path.join(openedFilesDir(), require('crypto').randomUUID());
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, a.name);
    fs.writeFileSync(file, Buffer.from(a.data, 'base64'), { mode: 0o600 });
    const error = await shell.openPath(file);
    return error ? { ok: false, error } : { ok: true };
  });
  ipcMain.handle('file:savePicture', async (_e, dataUrl, name) => {
    if (!vault.isUnlocked()) return { ok: false, locked: true };
    const m = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) return { ok: false, error: 'That picture can’t be saved.' };
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const res = await dialog.showSaveDialog(win, { title: 'Save picture', defaultPath: path.join(app.getPath('downloads'), `${String(name || 'Picture').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`) });
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    fs.writeFileSync(res.filePath, Buffer.from(m[2], 'base64'));
    return { ok: true };
  });
  // Reminders are only shown or changed while the vault is unlocked (they fire either way).
  ipcMain.handle('reminders:list', () => (vault.isUnlocked() ? reminders.all() : { upcoming: [], recent: [] }));
  // Reminders that went off while nobody was looking (also while locked: the notification showed the same text).
  ipcMain.handle('reminders:missed', () => reminders.missed().map(({ id, text, at, loginId, loginTitle }) => ({ id, text, at, loginId, loginTitle })));
  ipcMain.handle('reminders:dismissMissed', () => {
    reminders.dismissMissed();
    return { ok: true };
  });
  ipcMain.handle('reminders:clearHistory', () => {
    if (!vault.isUnlocked()) return { ok: false, locked: true };
    reminders.clearHistory();
    return { ok: true };
  });
  ipcMain.handle('reminders:add', (_e, r) => {
    if (!vault.isUnlocked()) return { ok: false, locked: true };
    try {
      return { ok: true, reminder: reminders.add(r || {}) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('reminders:remove', (_e, id) => {
    if (!vault.isUnlocked()) return { ok: false, locked: true };
    reminders.remove(String(id));
    return { ok: true };
  });
  // Edit an upcoming reminder, or run a sent one again with a new time (it moves back to upcoming).
  ipcMain.handle('reminders:update', (_e, id, r) => {
    if (!vault.isUnlocked()) return { ok: false, locked: true };
    try {
      return { ok: true, reminder: reminders.update(String(id), r || {}) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('reminders:again', (_e, id, r) => {
    if (!vault.isUnlocked()) return { ok: false, locked: true };
    try {
      return { ok: true, reminder: reminders.again(String(id), r || {}) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(
    'vault:delete',
    guarded((_e, id) => {
      vault.remove(id);
      reminders.loginDeleted(id); // its upcoming reminders go with it
    })
  );
  ipcMain.handle('vault:folders', () => (vault.isUnlocked() ? vault.folders() : []));
  ipcMain.handle('vault:addFolder', guarded((_e, name, parent) => vault.addFolder(name, typeof parent === 'string' ? parent : '')));
  ipcMain.handle('vault:moveFolder', guarded((_e, name, parent) => vault.moveFolder(String(name), typeof parent === 'string' ? parent : '')));
  ipcMain.handle('vault:moveToFolder', guarded((_e, id, folder) => forDisplay(vault.moveToFolder(id, folder).id)));
  ipcMain.handle('vault:renameFolder', guarded((_e, from, to) => vault.renameFolder(from, to)));
  ipcMain.handle('vault:deleteFolder', guarded((_e, name) => vault.deleteFolder(name)));

  ipcMain.handle(
    'vault:changeMaster',
    guarded(async (_e, current, next) => {
      if (typeof next !== 'string' || next.length < 8) {
        return { ok: false, error: 'New master password must be at least 8 characters.' };
      }
      const ok = await vault.changeMasterPassword(current, next);
      if (ok) biometric.refresh(vault.keyInfo()); // keep Touch ID / Hello working with the new password
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
      case 'fullscreen': return w.setFullScreen(!w.isFullScreen());
      case 'close': return w.close();
      case 'quit': return quitFromMenu();
      case 'zoomIn': return stepZoom(1);
      case 'zoomOut': return stepZoom(-1);
      case 'zoomReset': return setZoom(1);
    }
  });
  ipcMain.handle('zoom:get', () => zoomFactor());
  ipcMain.handle('zoom:set', (_e, z) => setZoom(z));
  ipcMain.handle('zoom:step', (_e, dir) => stepZoom(dir > 0 ? 1 : -1));
  // The page can't reliably tell whether its window is hidden (e.g. started in the tray), so ask here.
  ipcMain.handle('window:isVisible', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return !!(w && w.isVisible() && !w.isMinimized());
  });
  ipcMain.handle('window:isMaximized', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return w ? w.isMaximized() : false;
  });

  // Settings: keep running in the tray / open at sign-in.
  ipcMain.handle('prefs:get', () => ({ ...prefs(), platform: process.platform, installed: app.isPackaged }));
  ipcMain.handle('prefs:set', (_e, key, value) => {
    if (key === 'revealSeconds') {
      const n = Math.round(Number(value));
      if (Number.isFinite(n) && n >= 0 && n < 86400) settings.set('revealSeconds', n);
      return { ...prefs(), platform: process.platform, installed: app.isPackaged };
    }
    if (!['keepRunning', 'openAtLogin', 'autoInstall'].includes(key)) return prefs();
    settings.set(key, !!value);
    applyBackgroundPrefs();
    maybeAutoInstall();
    return { ...prefs(), platform: process.platform, installed: app.isPackaged };
  });

  // Settings → Notifications.
  ipcMain.handle('notify:get', () => notifyState());
  ipcMain.handle(
    'notify:set',
    guarded(async (_e, kind, on) => {
      if (!NOTIFY_KINDS.includes(kind)) return notifyState();
      settings.set('notify', { ...notifyPrefs(), [kind]: !!on });
      publishShared();
      return notifyState();
    })
  );
  ipcMain.handle(
    'notify:scope',
    guarded(async (_e, scope) => {
      settings.set('notifyScope', scope === 'device' ? 'device' : 'all');
      publishShared(); // "All my computers": this computer's choices now apply everywhere
      return notifyState();
    })
  );

  ipcMain.handle('update:status', () => updater.getStatus());
  ipcMain.handle('update:check', () => updater.check(true));
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => restartToUpdate());
  // A one-time message for after the restart ("Saved … for you before closing").
  ipcMain.handle('notice:take', () => {
    const notice = settings.get('savedNotice') || null;
    if (notice) settings.set('savedNotice', null);
    return notice;
  });

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
  // Opening Password Vault again (e.g. from the Start menu) shows the running copy.
  app.on('second-instance', () => showWindow());

  // Lets Windows show notifications under the app's own name.
  if (process.platform === 'win32') app.setAppUserModelId('com.matt.passwordvault');

  app.whenReady().then(() => {
    // Started from source (npm start, a test script) instead of the installed app: Electron would show its own
    // default logo, so use the app's logo in the Dock (Mac) the same way the installed app has it.
    if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
      try { app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon-mac.png')); } catch (e) { /* cosmetic only */ }
    }
    const userData = app.getPath('userData');
    localPath = path.join(userData, 'vault.json');
    backupDir = path.join(userData, 'backups');
    settings = new sync.Settings(path.join(userData, 'settings.json'));
    if (!settings.get('deviceId')) settings.set('deviceId', require('crypto').randomUUID());
    setDeviceId(settings.get('deviceId'));
    // 1.7–1.8 had a single on/off switch for change notifications.
    if (settings.get('notifyChanges') === false && !settings.get('notify')) {
      settings.set('notify', { added: false, updated: false, deleted: false, updates: true });
    }
    settings.set('notifyChanges', null);
    // After an update installed itself in the background, start quietly in the tray again.
    const relaunchedAt = settings.get('relaunchHiddenAt');
    if (relaunchedAt) {
      if (Date.now() - relaunchedAt < 10 * 60 * 1000) startedHidden = true;
      settings.set('relaunchHiddenAt', null);
      if (Date.now() - relaunchedAt < 10 * 60 * 1000 && Notification.isSupported() && notifyPrefs().updates) {
        new Notification({ title: 'Password Vault was updated', body: `It updated itself in the background and is now version ${app.getVersion()}.` }).show();
      }
    }
    updater.setNotificationFilter(() => notifyPrefs().updates);
    openVaultAt(settings.get('vaultPath') || localPath);
    loadNotifyKey();
    catchUpOnStart();
    clearOpenedFiles(); // left over if the computer shut down while a file was open
    registerIpc();
    buildMenu();
    createWindow();
    updater.init((status) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
    });
    updater.setInstallHooks((auto) => {
      quitting = true; // let every window really close
      if (auto) settings.set('relaunchHiddenAt', Date.now()); // …and start again quietly in the tray afterwards
    });
    updater.setAutoInstallCheck(() => prefs().autoInstall && !(win && !win.isDestroyed() && (win.isVisible() || win.isMinimized())));
    updater.onStatus((s) => {
      rebuildTrayMenu();
      if (s.state === 'downloaded') setTimeout(maybeAutoInstall, 1000);
    });
    applyBackgroundPrefs();
    if (startedHidden && !tray) showWindow(); // never end up running with no window and no tray icon
    else if (startedHidden) dockAway(); // started quietly at sign-in: just the menu bar icon
    // Reminders: fire any that came due while the app wasn't running, then keep a timer for the next one.
    // Clicking one opens the app (and the login it's about, once unlocked).
    let remindersStarting = true;
    reminders.setOnChange(pushReminders); // a change made here is saved to the synced vault straight away
    reminders.init((fired, clicked) => {
      // Seen already when the user clicked its notification, or was looking at the app when it went off.
      // Otherwise the app shows an "a reminder went off" message the next time it's opened.
      // (Ones that came due while the app wasn't running are never "seen": the message shows when it starts.)
      const looking = !remindersStarting && win && !win.isDestroyed() && win.isVisible() && win.isFocused();
      if (clicked || looking) reminders.markSeen(fired);
      send('reminders:changed');
      if (clicked) {
        showWindow();
        if (fired[0].loginId) send('reminder:open', fired[0].loginId);
      }
    });
    remindersStarting = false;
    // Clicking a notification (e.g. "update available") brings the app to the front.
    app.on('show-window', showWindow);

    // Auto-lock: on inactivity, when the computer locks, or when it goes to sleep.
    setInterval(() => {
      if (powerMonitor.getSystemIdleTime() >= AUTO_LOCK_SECONDS) lockVault('idle');
      checkForRemoteChanges(); // backup in case a file-change notice was missed
    }, 15000);
    // iCloud Drive: keep asking for the latest copy of the vault, and look at what arrived a moment later.
    setInterval(() => {
      if (!inICloud()) return;
      nudgeICloud();
      setTimeout(checkForRemoteChanges, 3000);
    }, 30000);
    powerMonitor.on('lock-screen', () => lockVault('system'));
    powerMonitor.on('suspend', () => lockVault('system'));
    // Look for updates soon after the computer wakes up or is unlocked (timers pause during sleep).
    powerMonitor.on('resume', () => {
      updater.checkSoon(15000);
      reminders.check(); // timers pause during sleep
    });
    powerMonitor.on('unlock-screen', () => updater.checkSoon(5000));

    app.on('activate', showWindow); // Mac: clicking the Dock icon
  });

  app.on('window-all-closed', () => {
    lockVault('closed');
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true; // let the window really close (also when an update installs)
    if (watchedPath) fs.unwatchFile(watchedPath);
    lockVault('closed');
    clearTimeout(clipboardTimer);
  });
}
