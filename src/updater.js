'use strict';
// App updates, published as GitHub Releases (see README "Releasing an update").
//
// Windows: the update downloads inside the app and installs on restart.
// Mac: the app isn't signed by Apple, and macOS only lets signed apps update
//      themselves, so on Mac the app tells you about the update and opens the
//      download page instead.

const { app, Notification, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const pkg = require('../package.json');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // every 4 hours while the app is open
const IS_MAC = process.platform === 'darwin';
const publish = (pkg.build && pkg.build.publish) || {};
const RELEASES_URL = `https://github.com/${publish.owner}/${publish.repo}/releases/latest`;
const CONFIGURED = Boolean(publish.owner) && !/YOUR-GITHUB-USERNAME/.test(publish.owner);

let send = () => {};
let status = { state: 'idle', version: null, percent: 0, error: null };
let manualCheck = false;
let notifiedVersion = null;

function setStatus(patch) {
  status = { ...status, ...patch };
  send({ ...status, currentVersion: app.getVersion(), isMac: IS_MAC });
}

function notify(version) {
  if (notifiedVersion === version || !Notification.isSupported()) return;
  notifiedVersion = version;
  const n = new Notification({
    title: 'Password Vault update available',
    body: `Version ${version} is ready. Open Password Vault to update.`,
  });
  n.on('click', () => app.emit('show-window'));
  n.show();
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

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => setStatus({ state: 'none' }));
  autoUpdater.on('update-available', (info) => {
    setStatus({ state: 'available', version: info.version });
    notify(info.version);
  });
  autoUpdater.on('download-progress', (p) => setStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'downloaded', version: info.version, percent: 100 }));
  autoUpdater.on('error', (err) => {
    // Automatic background checks fail quietly (e.g. no internet); only show errors you asked for.
    if (manualCheck || status.state === 'downloading') {
      setStatus({ state: 'error', error: friendlyError(err) });
    } else {
      setStatus({ state: 'idle' });
    }
  });

  const canCheck = app.isPackaged || process.env.PV_UPDATE_TEST_URL;
  if (canCheck && (CONFIGURED || process.env.PV_UPDATE_TEST_URL)) {
    setTimeout(() => check(false), 5000);
    setInterval(() => check(false), CHECK_EVERY_MS);
  }
}

function friendlyError(err) {
  const msg = String((err && err.message) || err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR|network/i.test(msg)) return 'Could not reach the update server. Check your internet connection.';
  if (/404|latest.*\.yml/i.test(msg)) return 'No published updates were found yet.';
  return 'Something went wrong while updating. Please try again later.';
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
  setStatus({ state: 'downloading', percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    /* handled by the 'error' event */
  }
  return status;
}

function install() {
  if (status.state === 'downloaded') autoUpdater.quitAndInstall(false, true);
}

module.exports = {
  init,
  check,
  download,
  install,
  getStatus: () => ({ ...status, currentVersion: app.getVersion(), isMac: IS_MAC }),
};
