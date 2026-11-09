'use strict';
// Unlock with Touch ID (Mac) or Windows Hello (Windows: fingerprint, face or PIN).
//
// How it works: when you turn it on (with your master password), the vault's encryption key
// is stored on this computer, sealed by the operating system's own secure storage
// (Mac Keychain / Windows DPAPI via Electron safeStorage). It's only handed back after
// Touch ID / Windows Hello confirms it's you. Your master password is still required:
//   - every RECHECK_DAYS days,
//   - after the master password is changed (here or on another computer),
//   - if you turn the feature off and on again.

const { app, safeStorage, systemPreferences, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const RECHECK_DAYS = 7;
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

const name = () => (IS_MAC ? 'Touch ID' : 'Windows Hello');
const storeFile = () => path.join(app.getPath('userData'), 'biometric.json');

// --- Windows Hello via the built-in Windows Runtime API, run through PowerShell -------------
const WIN_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  } | Select-Object -First 1
  $null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
  function Wait-Op($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait() | Out-Null; $t.Result }
  if ($env:PV_HELLO_ACTION -eq 'verify') {
    $r = Wait-Op ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($env:PV_HELLO_MESSAGE)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
  } else {
    $r = Wait-Op ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
  }
  Write-Output $r
} catch { Write-Output "Error: $($_.Exception.Message)" }
`;
const WIN_ENCODED = Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64');

function runHello(action, message) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', WIN_ENCODED],
      { windowsHide: true, timeout: 120000, env: { ...process.env, PV_HELLO_ACTION: action, PV_HELLO_MESSAGE: message || '' } },
      (err, stdout) => resolve(err ? 'Error' : String(stdout).trim())
    );
  });
}

let winAvailable = null; // cached: checking takes ~1 second

async function hardwareAvailable() {
  if (process.env.PV_TEST_BIOMETRIC) return true; // automated tests only
  if (IS_MAC) {
    try {
      return systemPreferences.canPromptTouchID();
    } catch {
      return false;
    }
  }
  if (IS_WIN) {
    if (winAvailable === null) winAvailable = (await runHello('check')) === 'Available';
    return winAvailable;
  }
  return false;
}

/** Ask for Touch ID / Windows Hello. Resolves true only if the person was verified. */
async function prompt(reason) {
  if (process.env.PV_TEST_BIOMETRIC) return process.env.PV_TEST_BIOMETRIC === 'pass'; // automated tests only
  if (IS_MAC) {
    try {
      await systemPreferences.promptTouchID(reason);
      return true;
    } catch {
      return false;
    }
  }
  if (IS_WIN) {
    // Bring our window forward so the Windows Hello dialog appears on top of it.
    const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (w) w.focus();
    return (await runHello('verify', reason)) === 'Verified';
  }
  return false;
}

// --- sealed key storage -------------------------------------------------------------------
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

function disable() {
  try {
    fs.rmSync(storeFile(), { force: true });
  } catch {
    /* already gone */
  }
}

/** Seal the vault key for this vault file. `info` = { key: Buffer, salt: base64, filePath }. */
function saveKey(info) {
  const sealed = safeStorage.encryptString(info.key.toString('base64'));
  const prev = readStore();
  writeStore({
    filePath: info.filePath,
    salt: info.salt,
    sealedKey: sealed.toString('base64'),
    enabledAt: (prev && prev.enabledAt) || new Date().toISOString(),
    passwordAt: new Date().toISOString(),
  });
}

/** Called after every successful master-password unlock: keep the stored key fresh. */
function refresh(info) {
  const s = readStore();
  if (!s) return;
  if (s.filePath !== info.filePath || s.salt !== info.salt) return saveKey(info); // vault moved or password changed here
  s.passwordAt = new Date().toISOString();
  writeStore(s);
}

/** Current state, for the lock screen and Settings. */
async function status(vaultInfo) {
  const s = readStore();
  const base = { name: name(), platform: process.platform, available: false, enabled: false, needsPassword: false, reason: null };
  if (!safeStorage.isEncryptionAvailable() || !(await hardwareAvailable())) return base;
  base.available = true;
  if (!s) return base;
  base.enabled = true;
  if (vaultInfo && (s.filePath !== vaultInfo.filePath || (vaultInfo.salt && s.salt !== vaultInfo.salt))) {
    base.needsPassword = true;
    base.reason = 'changed';
  } else if (Date.now() - new Date(s.passwordAt).getTime() > RECHECK_DAYS * 864e5) {
    base.needsPassword = true;
    base.reason = 'expired';
  }
  return base;
}

/** Prompt, then hand back the stored key (Buffer) or null. */
async function unlockKey(reason) {
  const s = readStore();
  if (!s) return { error: 'notEnabled' };
  if (Date.now() - new Date(s.passwordAt).getTime() > RECHECK_DAYS * 864e5) return { error: 'expired' };
  if (!(await prompt(reason))) return { error: 'cancelled' };
  try {
    const key = Buffer.from(safeStorage.decryptString(Buffer.from(s.sealedKey, 'base64')), 'base64');
    return { key, salt: s.salt, filePath: s.filePath };
  } catch {
    disable();
    return { error: 'unreadable' };
  }
}

module.exports = { status, prompt, saveKey, refresh, disable, unlockKey, name, RECHECK_DAYS };
