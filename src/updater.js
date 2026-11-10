'use strict';
// App updates, published as GitHub Releases (see README "Releasing an update").
//
// Windows: the update downloads inside the app and installs silently (no installer windows).
// Mac: the app isn't signed by Apple, and macOS's own updater (Squirrel.Mac, used by electron-updater)
//      refuses to update unsigned apps. So on a Mac this file does the update itself: it downloads the
//      release's .zip, checks it against the SHA-512 in the release, unpacks it, and when installing, a tiny
//      helper script waits for the app to quit, swaps the new app in and opens it. If anything about that
//      isn't possible (app not in a writable folder, download fails…), it falls back to opening the
//      download page.

const { app, Notification, shell, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
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
let latestInfo = null; // what the newest release says (files, checksums)
let macReady = null; // Mac: { bundle, newApp, dir } once an update is unpacked and ready
let installHooks = () => {}; // called just before the app quits to install (lets main.js really quit)
let autoInstallNow = () => false; // would a downloaded update install by itself right now?
const RETRY_LATER_MS = 10 * 60 * 1000; // after a "server busy" failure, try the download again in 10 minutes

function setStatus(patch) {
  status = { ...status, ...patch };
  const full = { ...status, currentVersion: app.getVersion(), isMac: IS_MAC };
  send(full);
  for (const fn of listeners) fn(full);
}

let activeNotification = null; // keep a reference so Windows doesn't drop the click handler
let allowNotification = () => true; // Settings → Notifications → App updates
function notify(version, title, body) {
  const key = `${version}:${title}`;
  if (notifiedVersion === key || !Notification.isSupported() || !allowNotification()) return;
  notifiedVersion = key;
  logLine(`notification: ${title}`);
  activeNotification = new Notification({ title, body });
  activeNotification.on('click', () => app.emit('show-window'));
  activeNotification.show();
}

function init(sendToRenderer) {
  send = sendToRenderer;
  // Leftovers of a previous Mac update (the unpacked app is a few hundred MB).
  if (IS_MAC) fs.rm(path.join(app.getPath('userData'), 'update'), { recursive: true, force: true }, () => {});
  autoUpdater.autoDownload = false; // downloads are started by download() below
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
    logLine(`update available: ${info.version}`);
    latestInfo = info;
    setStatus({ state: 'available', version: info.version, manual: false });
    // Fetch it quietly in the background; the app then installs it by itself while it's closed into the tray.
    download();
  });
  autoUpdater.on('download-progress', (p) => setStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ state: 'downloaded', version: info.version, percent: 100 });
    // (When it's going to install by itself right now, there's nothing to tell you until it has.)
    if (!autoInstallNow())
      notify(info.version, 'Password Vault update ready', `Version ${info.version} has downloaded. It installs by itself when you close the window, or click here and choose “Restart & update”.`);
  });
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

// ---------- Mac: downloading and installing by ourselves ----------
const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out))));

// The .app this copy is running from, or null if it can't be replaced in place (running from a disk image,
// from a quarantined download that macOS has "translocated", or from a folder this user can't write to).
function replaceableBundle() {
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  if (!bundle.endsWith('.app') || /^\/Volumes\//.test(bundle) || /AppTranslocation/.test(bundle)) return null;
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    fs.accessSync(bundle, fs.constants.W_OK);
    return bundle;
  } catch {
    return null;
  }
}

function macZipFor(info) {
  const file = ((info && info.files) || []).find((f) => /\.zip$/i.test(f.url));
  if (!file || !file.sha512) return null;
  const base = process.env.PV_UPDATE_TEST_URL
    ? process.env.PV_UPDATE_TEST_URL.replace(/\/?$/, '/')
    : `https://github.com/${publish.owner}/${publish.repo}/releases/download/v${info.version}/`;
  return { url: new URL(file.url, base).href, sha512: file.sha512, size: file.size || 0, name: path.basename(file.url) };
}

async function downloadMac() {
  const bundle = replaceableBundle();
  const zip = macZipFor(latestInfo);
  if (!bundle || !zip) {
    // Can't update in place: send them to the download page, once.
    logLine(`mac: cannot update in place (bundle ${bundle || 'not replaceable'}, zip ${zip ? 'found' : 'missing'})`);
    setStatus({ state: 'available', manual: true });
    return status;
  }
  const dir = path.join(app.getPath('userData'), 'update');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, zip.name);
  setStatus({ state: 'downloading', percent: 0, error: null, manual: false });
  const res = await net.fetch(zip.url);
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || zip.size || 0;
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(zipPath);
  let got = 0;
  let lastPercent = -1;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    if (!out.write(value)) await new Promise((r) => out.once('drain', r));
    got += value.length;
    const percent = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
    if (percent !== lastPercent) {
      lastPercent = percent;
      setStatus({ state: 'downloading', percent });
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  if (hash.digest('base64') !== zip.sha512) throw new Error('sha512 checksum mismatch');
  // Unpack, then check it looks like the app before trusting it.
  const unpacked = path.join(dir, 'new');
  await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpacked]);
  const appName = fs.readdirSync(unpacked).find((n) => n.endsWith('.app'));
  if (!appName) throw new Error('the update did not contain an app');
  const newApp = path.join(unpacked, appName);
  if (!fs.existsSync(path.join(newApp, 'Contents', 'Info.plist')) || !fs.existsSync(path.join(newApp, 'Contents', 'MacOS'))) throw new Error('the update looks incomplete');
  await run('/usr/bin/xattr', ['-cr', newApp]).catch(() => {}); // no "downloaded from the internet" flag on our own download
  fs.rmSync(zipPath, { force: true });
  macReady = { bundle, newApp, dir };
  logLine(`mac: update ${latestInfo.version} unpacked`);
  autoUpdater.emit('update-downloaded', latestInfo); // same follow-up as Windows: status, notification, auto-install
}

// Waits for this app to quit, swaps the new app in, and opens it. Kept very small and defensive:
// if the swap fails, the old app is put back.
const MAC_INSTALL_SCRIPT = `#!/bin/bash
PID="$1"; DEST="$2"; NEW="$3"
for i in $(seq 1 150); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
OLD="$DEST.old-$$"
if mv "$DEST" "$OLD"; then
  if /usr/bin/ditto "$NEW" "$DEST"; then rm -rf "$OLD"; else rm -rf "$DEST"; mv "$OLD" "$DEST"; fi
fi
/usr/bin/open "$DEST"
`;

function installMac(auto) {
  if (!macReady || !fs.existsSync(macReady.newApp)) {
    setStatus({ state: 'error', error: 'The downloaded update is no longer there. Please try again.' });
    return;
  }
  const script = path.join(macReady.dir, 'install.sh');
  fs.writeFileSync(script, MAC_INSTALL_SCRIPT, { mode: 0o755 });
  logLine(`mac: installing${auto ? ' (automatic)' : ''}`);
  installHooks(auto);
  const child = spawn('/bin/bash', [script, String(process.pid), macReady.bundle, macReady.newApp], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 150);
}

async function download() {
  if (IS_MAC) {
    if (downloadInProgress || status.state === 'downloaded') return status;
    // Asked for from the banner / Settings after we couldn't update in place: open the download page.
    if (status.manual && status.state === 'available') {
      shell.openExternal(RELEASES_URL);
      return status;
    }
    clearTimeout(retryTimer);
    downloadInProgress = true;
    try {
      await downloadMac();
    } catch (err) {
      logLine(`mac download failed: ${err && err.message ? err.message : err}`);
      setStatus({ state: 'error', error: friendlyError(err, { willRetry: isServerBusy(err) }) });
      if (isServerBusy(err)) retryTimer = setTimeout(() => status.state === 'error' && download(), RETRY_LATER_MS);
    } finally {
      downloadInProgress = false;
    }
    if (status.manual && status.state === 'available' && latestInfo)
      notify(latestInfo.version, 'Password Vault update available', `Version ${latestInfo.version} is ready. Click here to get it.`);
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
  // Still let you know there's a new version, even though the background download didn't work yet.
  if (status.version) notify(status.version, 'Password Vault update available', `Version ${status.version} is available. Click here to install it.`);
  if (busy) {
    retryTimer = setTimeout(() => {
      if (status.state === 'error') download();
    }, RETRY_LATER_MS);
  }
  return status;
}

/** Install the downloaded update and start the app again. `auto`: nobody asked, so the app should come back hidden. */
function install({ auto = false } = {}) {
  if (status.state !== 'downloaded') return;
  if (IS_MAC) return installMac(auto);
  installHooks(auto);
  // silent: no installer windows; true: start Password Vault again afterwards
  autoUpdater.quitAndInstall(true, true);
}

module.exports = {
  setNotificationFilter: (fn) => (allowNotification = fn),
  setInstallHooks: (fn) => (installHooks = fn),
  setAutoInstallCheck: (fn) => (autoInstallNow = fn),
  init,
  check,
  checkSoon,
  onStatus,
  download,
  install,
  getStatus: () => ({ ...status, currentVersion: app.getVersion(), isMac: IS_MAC }),
};
