'use strict';
// App updates, published as GitHub Releases (see README "Releasing an update").
//
// Windows: the update downloads inside the app and installs on restart.
// Mac: the app isn't signed by Apple, and macOS only lets signed apps update
//      themselves, so on Mac the app tells you about the update and opens the
//      download page instead.

const { app, Notification, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

const CHECK_EVERY_MS = 30 * 60 * 1000; // every 30 minutes while the app is running (window open or in the tray)
const MIN_GAP_MS = 5 * 60 * 1000; // extra checks (wake from sleep, window opened) at most every 5 minutes
const IS_MAC = process.platform === 'darwin';

// Where updates come from. The installer removes the "build" section from the app's own
// package.json, so the installed app reads app-update.yml (written next to it by the installer
// build) instead; while developing, it reads package.json.
function readPublishConfig() {
  if (app.isPackaged) {
    try {
      const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
      const get = (key) => (yml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [])[1];
      return { owner: get('owner') && get('owner').trim(), repo: get('repo') && get('repo').trim() };
    } catch {
      return {};
    }
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return (pkg.build && pkg.build.publish) || {};
  } catch {
    return {};
  }
}
const publish = readPublishConfig();
const RELEASES_URL = `https://github.com/${publish.owner}/${publish.repo}/releases/latest`;
const CONFIGURED = Boolean(publish.owner) && !/YOUR-GITHUB-USERNAME/.test(publish.owner);

let send = () => {};
const listeners = []; // e.g. the tray menu
let status = { state: 'idle', version: null, percent: 0, error: null };
let manualCheck = false;
let notifiedVersion = null;
let lastCheck = 0;
let checksEnabled = false;
let downloadInProgress = false;
let retryTimer = null;
const RETRY_LATER_MS = 10 * 60 * 1000; // after a "server busy" failure, try the download again in 10 minutes

function setStatus(patch) {
  status = { ...status, ...patch };
  const full = { ...status, currentVersion: app.getVersion(), isMac: IS_MAC };
  send(full);
  for (const fn of listeners) fn(full);
}

let activeNotification = null; // keep a reference so Windows doesn't drop the click handler
let allowNotification = () => true; // Settings → Notifications → App updates
function notify(version) {
  if (notifiedVersion === version || !Notification.isSupported() || !allowNotification()) return;
  notifiedVersion = version;
  activeNotification = new Notification({
    title: 'Password Vault update available',
    body: `Version ${version} is ready to install. Click here to update.`,
  });
  activeNotification.on('click', () => app.emit('show-window'));
  activeNotification.show();
}

function init(sendToRenderer) {
  send = sendToRenderer;
  autoUpdater.autoDownload = false; // ask first
  autoUpdater.autoInstallOnAppQuit = true; // a downloaded update also installs when you next quit
  autoUpdater.logger = null;

  // Testing only (never in the installed app): point at a local update server.
  if (!app.isPackaged && process.env.PV_UPDATE_TEST_URL) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.PV_UPDATE_TEST_URL });
  }

  autoUpdater.on('checking-for-update', () => {
    // Background re-checks don't flash "Checking…" over an update that's already waiting.
    if (manualCheck || !['available', 'downloading', 'downloaded'].includes(status.state)) setStatus({ state: 'checking', error: null });
  });
  autoUpdater.on('update-not-available', () => {
    if (!['downloading', 'downloaded'].includes(status.state)) setStatus({ state: 'none' });
  });
  autoUpdater.on('update-available', (info) => {
    setStatus({ state: 'available', version: info.version });
    notify(info.version);
  });
  autoUpdater.on('download-progress', (p) => setStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'downloaded', version: info.version, percent: 100 }));
  autoUpdater.on('error', (err) => {
    logLine(`error (${downloadInProgress ? 'download' : manualCheck ? 'check' : 'background check'}): ${err && err.message ? err.message : err}`);
    // Downloads handle their own errors (with retries) in download().
    if (downloadInProgress) return;
    // Automatic background checks fail quietly (e.g. no internet); only show errors you asked for.
    if (manualCheck || status.state === 'downloading') {
      setStatus({ state: 'error', error: friendlyError(err) });
    } else if (!['available', 'downloaded'].includes(status.state)) {
      setStatus({ state: 'idle' });
    }
  });

  const canCheck = app.isPackaged || process.env.PV_UPDATE_TEST_URL;
  if (canCheck && (CONFIGURED || process.env.PV_UPDATE_TEST_URL)) {
    checksEnabled = true;
    setTimeout(() => check(false), 5000);
    setInterval(() => check(false), CHECK_EVERY_MS);
  }
}

/** Check soon after something happens (computer woke up, window opened) — at most every few minutes. */
function checkSoon(delayMs = 0) {
  if (!checksEnabled || Date.now() - lastCheck < MIN_GAP_MS) return;
  setTimeout(() => {
    if (Date.now() - lastCheck >= MIN_GAP_MS) check(false);
  }, delayMs);
}

function onStatus(fn) {
  listeners.push(fn);
}

// GitHub's file server occasionally answers "504 Gateway Time-out" (or 502/503) for a while.
const isServerBusy = (err) => /\b50[234]\b|gateway|service unavailable|timed? ?out/i.test(String((err && err.message) || err));

function friendlyError(err, { willRetry = false } = {}) {
  const msg = String((err && err.message) || err);
  if (isServerBusy(err)) {
    return willRetry
      ? "GitHub's download server isn't responding right now. Password Vault will try again automatically in a few minutes."
      : "GitHub's download server isn't responding right now. Please try again in a few minutes.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|net::ERR|network/i.test(msg)) return 'Could not reach the update server. Check your internet connection.';
  if (/404|latest.*\.yml/i.test(msg)) return 'No published updates were found yet.';
  if (/sha512|checksum/i.test(msg)) return "The downloaded update didn't pass its safety check, so it wasn't installed. Please try again.";
  return 'Something went wrong while updating. Please try again later.';
}

// A small log on this computer (Password Vault's data folder → logs/updater.log) so update problems can be diagnosed.
function logLine(text) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    const file = path.join(dir, 'updater.log');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, `${new Date().toISOString()} v${app.getVersion()} ${text}\n`);
  } catch {
    /* logging must never break updating */
  }
}

async function check(manual = true) {
  manualCheck = manual;
  if (!CONFIGURED && !process.env.PV_UPDATE_TEST_URL) {
    setStatus({ state: 'error', error: 'Updates are not set up yet (no GitHub repository configured).' });
    return status;
  }
  if (!app.isPackaged && !process.env.PV_UPDATE_TEST_URL) {
    setStatus({ state: 'error', error: 'Update checks only work in the installed app.' });
    return status;
  }
  if (status.state === 'downloading' || status.state === 'downloaded') return status;
  lastCheck = Date.now();
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    /* handled by the 'error' event */
  }
  return status;
}

async function download() {
  if (IS_MAC) {
    // Unsigned Mac apps can't replace themselves: open the download page instead.
    shell.openExternal(RELEASES_URL);
    return status;
  }
  if (downloadInProgress || status.state === 'downloaded') return status;
  clearTimeout(retryTimer);
  downloadInProgress = true;
  const waits = [5000, 15000]; // pause before the 2nd and 3rd attempt
  let lastErr = null;
  try {
    for (let attempt = 1; attempt <= waits.length + 1; attempt++) {
      setStatus({ state: 'downloading', percent: 0, error: null });
      try {
        await autoUpdater.downloadUpdate();
        logLine(`download ok (attempt ${attempt})`);
        return status; // 'update-downloaded' has set the state
      } catch (err) {
        lastErr = err;
        logLine(`download attempt ${attempt} failed: ${err && err.message ? err.message : err}`);
        if (attempt <= waits.length) await new Promise((r) => setTimeout(r, waits[attempt - 1]));
      }
    }
  } finally {
    downloadInProgress = false;
  }
  // All attempts failed. If GitHub's server is just busy, quietly try again later.
  const busy = isServerBusy(lastErr);
  setStatus({ state: 'error', error: friendlyError(lastErr, { willRetry: busy }) });
  if (busy) {
    retryTimer = setTimeout(() => {
      if (status.state === 'error') download();
    }, RETRY_LATER_MS);
  }
  return status;
}

function install() {
  if (status.state === 'downloaded') autoUpdater.quitAndInstall(false, true);
}

module.exports = {
  setNotificationFilter: (fn) => (allowNotification = fn),
  init,
  check,
  checkSoon,
  onStatus,
  download,
  install,
  getStatus: () => ({ ...status, currentVersion: app.getVersion(), isMac: IS_MAC }),
};
