'use strict';
const $ = (id) => document.getElementById(id);

// Hover tips in the app's own style (green, rounded) instead of the system's plain grey ones.
// Anything with a title="" gets one; the title moves to data-tip so the system tip doesn't show as well.
(() => {
  const tip = Object.assign(document.createElement('div'), { className: 'tip', role: 'tooltip' });
  tip.hidden = true;
  document.body.appendChild(tip);
  let target = null;
  let timer = null;
  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip.hidden = true;
  };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[title], [data-tip]');
    if (el === target) return;
    hide();
    if (!el) return;
    if (el.hasAttribute('title')) {
      el.dataset.tip = el.getAttribute('title');
      if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', el.dataset.tip);
      el.removeAttribute('title');
    }
    if (!el.dataset.tip) return;
    target = el;
    timer = setTimeout(() => {
      if (target !== el || !el.isConnected) return;
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      let top = r.bottom + 8;
      if (top + t.height > window.innerHeight - 8) top = r.top - t.height - 8; // no room below: show above
      tip.style.top = Math.max(8, top) + 'px';
      tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 8)) + 'px';
    }, 450);
  });
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
})();

// Spell check only where you write sentences (notes, reminders) — never names, usernames, websites or passwords.
document.querySelectorAll('input, textarea').forEach((el) => {
  if (el.dataset.spell !== 'on') el.spellcheck = false;
});

let entries = [];
let selectedId = null;
let editingId = null;
let creating = false;
let toastTimer = null;

// ---------- helpers ----------
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 2200);
}

function strength(pw) {
  if (!pw) return { score: 0, label: '' };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
  const bits = pw.length * Math.log2(pool || 1);
  if (bits < 40) return { score: 1, label: 'Weak' };
  if (bits < 60) return { score: 2, label: 'Fair' };
  if (bits < 80) return { score: 3, label: 'Good' };
  return { score: 4, label: 'Strong' };
}

// ---------- show / hide password (eye button) ----------
const EYE_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.5M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/></svg>';

function setEye(btn, visible) {
  const input = $(btn.dataset.target);
  input.type = visible ? 'text' : 'password';
  btn.innerHTML = visible ? EYE_CLOSED : EYE_OPEN;
  const label = visible ? 'Hide password' : 'Show password';
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

document.querySelectorAll('.eye-btn').forEach((btn) => {
  setEye(btn, false);
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the cursor in the field
  btn.addEventListener('click', () => setEye(btn, $(btn.dataset.target).type === 'password'));
});

// ---------- lock screen ----------
let providers = [];
let lockScreenShownBefore = false;

async function showLockScreen(message) {
  // Only the very first lock screen after the app opens may pop up Touch ID / Windows Hello by itself.
  const appJustOpened = !lockScreenShownBefore;
  lockScreenShownBefore = true;
  const status = await window.api.status();
  creating = !status.exists && !status.missing;
  hide($('app-screen'));
  show($('lock-screen'));
  closeSyncModal();
  $('master').value = '';
  $('master-confirm').value = '';
  $('lock-error').textContent = message || '';
  document.querySelectorAll('.eye-btn').forEach((btn) => setEye(btn, false));
  entries = [];
  selectedId = null;

  // Synced vault that can't be found right now.
  $('missing-panel').classList.toggle('hidden', !status.missing);
  $('lock-form').classList.toggle('hidden', status.missing);
  $('connect-link').classList.toggle('hidden', !creating);
  $('lock-sync').classList.toggle('hidden', !status.sync.synced || status.missing);
  $('lock-sync').textContent = `Synced via ${status.sync.name}`;
  if (status.missing) {
    $('lock-subtitle').textContent = `We can't find your vault in ${status.sync.name}.`;
    $('missing-text').textContent = `Make sure ${status.sync.name} is running and has finished syncing on this computer, then try again. (Looking in ${status.sync.path})`;
    return;
  }

  $('lock-subtitle').textContent = creating
    ? 'Create a master password to set up your vault.'
    : 'Enter your master password to unlock.';
  $('lock-submit').textContent = creating ? 'Create vault' : 'Unlock';
  $('master-confirm-wrap').classList.toggle('hidden', !creating);
  $('create-warning').classList.toggle('hidden', !creating);
  $('create-location-wrap').classList.toggle('hidden', !creating);
  if (creating) await fillCreateLocations();
  $('master').focus();
  await updateBioButton(appJustOpened && !message);
}

// ---------- Touch ID / Windows Hello ----------
async function updateBioButton(mayAutoPrompt) {
  hide($('bio-btn'));
  if (creating) return;
  const bio = await window.api.bioStatus();
  if (!bio.enabled || !bio.available) return;
  if (bio.needsPassword) {
    if (!$('lock-error').textContent) {
      $('lock-error').textContent =
        bio.reason === 'expired'
          ? `Enter your master password — ${bio.name} needs it once a week.`
          : `Your master password changed. Enter it once to keep using ${bio.name}.`;
    }
    return;
  }
  $('bio-btn-label').textContent = `Unlock with ${bio.name}`;
  show($('bio-btn'));
  // When the app first opens, ask straight away so you can just touch the sensor —
  // but not while it's starting up hidden in the tray (it asks when you open the window instead).
  if (mayAutoPrompt && (await window.api.isWindowVisible())) bioUnlock();
}

// Opened from the tray, a notification or the Dock: offer Touch ID / Windows Hello right away.
window.api.onShown(() => {
  if (!$('lock-screen').classList.contains('hidden') && !creating && !bioBusy) updateBioButton(true);
});

let bioBusy = false;
async function bioUnlock() {
  if (bioBusy) return;
  bioBusy = true;
  const btn = $('bio-btn');
  btn.disabled = true;
  $('lock-error').textContent = '';
  try {
    const res = await window.api.bioUnlock();
    if (res.ok) return openApp();
    if (res.needsPassword) {
      hide(btn);
      $('lock-error').textContent = res.error;
      $('master').focus();
    }
    // cancelled: just leave both options on screen
  } finally {
    btn.disabled = false;
    bioBusy = false;
  }
}

$('bio-btn').addEventListener('click', bioUnlock);

async function renderBio() {
  const bio = await window.api.bioStatus();
  $('bio-card').classList.toggle('hidden', !bio.available);
  if (!bio.available) return;
  $('bio-card-title').textContent = `Unlock with ${bio.name}`;
  const what = bio.platform === 'darwin' ? 'your fingerprint' : 'your fingerprint, face or PIN';
  if (bio.enabled) {
    $('bio-where').textContent = `${bio.name} is on`;
    $('bio-detail').textContent = `Unlock with ${what}. You'll still be asked for your master password once a week.`;
    $('bio-toggle').textContent = 'Turn off';
    $('bio-toggle').classList.remove('primary');
  } else {
    $('bio-where').textContent = `${bio.name} is off`;
    $('bio-detail').textContent = `Unlock Password Vault with ${what} instead of typing your master password.`;
    $('bio-toggle').textContent = 'Turn on';
    $('bio-toggle').classList.add('primary');
  }
  $('bio-toggle').dataset.enabled = bio.enabled ? '1' : '';
  $('bio-toggle').dataset.name = bio.name;
}

$('bio-toggle').addEventListener('click', async () => {
  const name = $('bio-toggle').dataset.name;
  if ($('bio-toggle').dataset.enabled) {
    await window.api.bioDisable();
    toast(`${name} turned off`);
    return renderBio();
  }
  $('bio-modal-title').textContent = `Turn on ${name}`;
  $('bio-modal-text').textContent = `Enter your master password. ${name} will then ask you to confirm it's you.`;
  $('bio-pw').value = '';
  $('bio-error').textContent = '';
  setEye(document.querySelector('[data-target="bio-pw"]'), false);
  show($('bio-modal'));
  $('bio-pw').focus();
});

function closeBioModal() {
  hide($('bio-modal'));
  $('bio-pw').value = '';
}
$('bio-cancel').addEventListener('click', closeBioModal);
$('bio-modal').addEventListener('mousedown', (e) => {
  if (e.target === $('bio-modal')) closeBioModal();
});

$('bio-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('bio-submit');
  btn.disabled = true;
  btn.textContent = 'Waiting…';
  try {
    const res = await window.api.bioEnable($('bio-pw').value);
    if (!res.ok) {
      $('bio-error').textContent = res.error;
      return;
    }
    closeBioModal();
    await afterRepaint();
    await renderBio();
    toast(`${$('bio-toggle').dataset.name} is on`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Turn on';
  }
});

async function fillCreateLocations() {
  providers = await window.api.syncProviders();
  const select = $('create-location');
  select.replaceChildren();
  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    select.appendChild(o);
  };
  add('', 'This computer only');
  providers.forEach((p, i) => add(String(i), `${p.name} — sync with my other computers`));
  add('other', 'Another synced folder…');
}

$('create-location').addEventListener('change', async () => {
  if ($('create-location').value !== 'other') return;
  const folder = await window.api.syncChooseFolder();
  if (!folder) return ($('create-location').value = '');
  providers.push({ id: 'folder', name: folder.split(/[\\/]/).pop() || folder, path: folder });
  const o = document.createElement('option');
  o.value = String(providers.length - 1);
  o.textContent = `${folder} — sync with my other computers`;
  $('create-location').insertBefore(o, $('create-location').lastElementChild);
  $('create-location').value = o.value;
});

$('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('master').value;
  const btn = $('lock-submit');
  $('lock-error').textContent = '';

  if (creating) {
    if (pw.length < 8) return ($('lock-error').textContent = 'Use at least 8 characters (longer is better).');
    if (pw !== $('master-confirm').value) return ($('lock-error').textContent = 'Passwords do not match.');
  }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = creating ? 'Creating…' : 'Unlocking…';
  try {
    let res;
    if (creating) {
      const choice = $('create-location').value;
      const provider = choice && choice !== 'other' ? providers[Number(choice)] : null;
      res = await window.api.create(pw, provider ? provider.path : undefined);
      if (res.existing) {
        // A vault is already in that cloud drive (set up on another computer): unlock that one.
        res = await window.api.unlock(pw);
        if (!res.ok) {
          await showLockScreen(`You already have a vault in ${provider.name}. Unlock it with the master password you chose on your other computer.`);
          return;
        }
        toast(`Connected to your vault in ${provider.name}`);
      }
    } else {
      res = await window.api.unlock(pw);
    }
    if (!res.ok) {
      $('lock-error').textContent = res.error;
      $('master').select();
      return;
    }
    await openApp();
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

$('connect-link').addEventListener('click', () => openSyncModal('connect'));
$('missing-retry').addEventListener('click', () => showLockScreen());
$('missing-find').addEventListener('click', () => openSyncModal('connect'));
$('missing-local').addEventListener('click', async () => {
  const sure = await ask({
    title: 'Start a new vault here?',
    text: 'This starts a brand-new, empty vault on this computer. Your synced vault stays where it is, and you can connect to it again later.',
    ok: 'Start new vault',
    input: false,
  });
  if (!sure) return;
  await window.api.syncUseLocal();
  showLockScreen();
});

// ---------- sync pop-up (connect to an existing vault, or turn sync on) ----------
let syncMode = null; // 'connect' | 'enable'
let syncChoice = null; // folder path

// Wait until the screen has actually been redrawn (two animation frames).
const afterRepaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function closeSyncModal() {
  hide($('sync-modal'));
  syncMode = null;
}

function initials(name) {
  return name.replace(/\(.*\)/, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function providerButton(name, detail, folder, iconText) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'provider';
  b.setAttribute('role', 'radio');
  const icon = document.createElement('span');
  icon.className = 'provider-icon';
  icon.textContent = iconText;
  const text = document.createElement('span');
  const n = document.createElement('span');
  n.className = 'provider-name';
  n.textContent = name;
  const p = document.createElement('span');
  p.className = 'provider-path';
  p.textContent = detail;
  text.append(n, p);
  b.append(icon, text);
  b.addEventListener('click', () => selectProvider(b, folder));
  return b;
}

function selectProvider(btn, folder) {
  document.querySelectorAll('#sync-modal .provider').forEach((x) => {
    x.classList.toggle('selected', x === btn);
    x.setAttribute('aria-checked', String(x === btn));
  });
  syncChoice = folder;
  $('sync-error').textContent = '';
  $('sync-submit').disabled = false;
}

async function openSyncModal(mode) {
  syncMode = mode;
  syncChoice = null;
  const connect = mode === 'connect';
  $('sync-modal-title').textContent = connect ? 'Connect to your vault' : 'Sync with your other computers';
  $('sync-modal-text').textContent = connect
    ? 'Choose the cloud drive where your other computer keeps Password Vault. You’ll then unlock it with the same master password.'
    : 'Your vault will be kept in a “Password Vault” folder in the cloud drive you choose. It stays encrypted — the cloud company can’t read it.';
  $('sync-submit').textContent = connect ? 'Connect' : 'Start syncing';
  $('sync-submit').disabled = true;
  $('sync-error').textContent = '';
  $('sync-pw').value = '';
  setEye(document.querySelector('[data-target="sync-pw"]'), false);
  $('sync-pw-wrap').classList.toggle('hidden', connect);
  hide($('sync-bio'));
  if (!connect) {
    // Offer Touch ID / Windows Hello instead of typing the master password, when it's on.
    window.api.bioStatus().then((bio) => {
      if (syncMode !== 'enable' || !bio.available || !bio.enabled || bio.needsPassword) return;
      $('sync-bio').dataset.name = bio.name;
      $('sync-bio-label').textContent = `Use ${bio.name} instead`;
      $('sync-pw').placeholder = `Confirm it's you — or use ${bio.name}`;
      show($('sync-bio'));
    });
    $('sync-pw').placeholder = "Confirm it's you";
  }
  $('provider-other-path').textContent = 'Any folder your cloud app keeps in sync';
  $('provider-other').classList.remove('selected');

  const list = $('provider-list');
  list.replaceChildren();
  providers = await window.api.syncProviders();
  if (!providers.length) {
    const p = document.createElement('p');
    p.className = 'provider-empty';
    p.textContent = 'No cloud drives found on this computer. Install iCloud, OneDrive, Google Drive or Dropbox and sign in — or choose a synced folder yourself below.';
    list.appendChild(p);
  }
  const ICONS = { icloud: 'iC', onedrive: 'OD', 'onedrive-work': 'OD', gdrive: 'GD', dropbox: 'DB' };
  for (const p of providers) list.appendChild(providerButton(p.name, p.path, p.path, ICONS[p.id] || initials(p.name)));
  show($('sync-modal'));
}

$('provider-other').addEventListener('click', async () => {
  const folder = await window.api.syncChooseFolder();
  if (!folder) return;
  $('provider-other-path').textContent = folder;
  selectProvider($('provider-other'), folder);
});

$('sync-cancel').addEventListener('click', closeSyncModal);
$('sync-modal').addEventListener('mousedown', (e) => {
  if (e.target === $('sync-modal')) closeSyncModal();
});

$('sync-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!syncChoice) return ($('sync-error').textContent = 'Choose where your vault should be kept.');
  const btn = $('sync-submit');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = syncMode === 'connect' ? 'Connecting…' : 'Setting up…';
  try {
    if (syncMode === 'connect') {
      const res = await window.api.syncConnect(syncChoice);
      if (!res.ok) {
        $('sync-error').textContent =
          'No Password Vault found there yet. On your other computer, open Settings → Sync and choose this cloud drive, then wait a minute for it to sync here.';
        return;
      }
      closeSyncModal();
      await showLockScreen();
      toast(`Found your vault in ${res.where.name}. Unlock it with that vault’s master password.`);
    } else {
      if (!$('sync-pw').value) {
        return ($('sync-error').textContent = $('sync-bio').classList.contains('hidden')
          ? 'Enter your master password to confirm.'
          : `Enter your master password, or use ${$('sync-bio').dataset.name} below.`);
      }
      await enableSync(false);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// Turn sync on, confirming with the typed master password or Touch ID / Windows Hello.
async function enableSync(useBiometric) {
  const currentPw = useBiometric ? null : $('sync-pw').value;
  let res = await window.api.syncEnable(syncChoice, currentPw, useBiometric);
  $('sync-pw').value = '';
  if (!res.ok && res.differentPassword) {
    // That folder's vault was set up with a different master password. Say what joining it means,
    // and have them type that vault's password.
    const folder = syncChoice;
    hide($('sync-modal'));
    const typed = await ask({
      title: 'This vault has a different master password',
      text:
        'The vault in that folder was set up with a different master password from the one you use here. ' +
        'Type that vault’s master password to connect. Your logins from this computer will be combined into it, ' +
        'and from now on you’ll unlock Password Vault on this computer with that password instead of your current one. ' +
        'If you later switch to a folder whose vault has another password, it will change again.',
      placeholder: 'Master password for the vault in that folder',
      password: true,
      ok: 'Connect and change password',
      validate: async (pw) => {
        if (!pw) return 'Type the master password for the vault in that folder.';
        res = await window.api.syncEnable(folder, currentPw, false, pw);
        if (res.ok || res.locked) return null;
        return res.error || 'That isn’t the master password for the vault in that folder.';
      },
    });
    if (!typed) {
      show($('sync-modal'));
      $('sync-error').textContent = 'Not connected. Your vault and master password haven’t changed.';
      return;
    }
    if (res.locked) return;
  }
  if (!res.ok) {
    if (res.cancelled || res.locked) return;
    if (res.needsPassword) {
      hide($('sync-bio'));
      $('sync-pw').focus();
    }
    $('sync-error').textContent = res.error;
    return;
  }
  closeSyncModal();
  await afterRepaint(); // let the pop-up and its blur disappear before the card changes size
  await refreshEntries();
  await renderSync(res.status);
  if (res.passwordChanged) {
    await ask({
      title: 'Your master password has changed',
      text:
        `This computer now uses the vault in ${res.status.name}, so your master password here is now that vault’s password — ` +
        'the one you just typed. Your old master password won’t unlock Password Vault any more. ' +
        'Your logins from this computer were combined into it.',
      input: false,
      cancel: false,
      ok: 'Got it',
    });
  }
  toast(`Syncing via ${res.status.name}`);
}

$('sync-bio').addEventListener('click', async () => {
  if (!syncChoice) return ($('sync-error').textContent = 'Choose where your vault should be kept.');
  $('sync-error').textContent = '';
  const btn = $('sync-bio');
  btn.disabled = true;
  try {
    await enableSync(true);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Background & startup (Settings) ----------
async function renderBackground(p) {
  p = p || (await window.api.getPrefs());
  const mac = p.platform === 'darwin';
  $('bg-keep-title').textContent = mac ? 'Keep running in the menu bar' : 'Keep running in the system tray';
  $('bg-keep-text').textContent = `When you close the window, Password Vault locks and stays in the ${mac ? 'menu bar' : 'tray'}, so it can keep checking for updates and notify you.`;
  $('bg-login-text').textContent = p.installed
    ? `Starts quietly in the ${mac ? 'menu bar' : 'tray'}, so you get update notifications even if you don't open it.`
    : 'Only available in the installed app.';
  $('bg-keep').checked = p.keepRunning;
  $('bg-login').checked = p.keepRunning && p.openAtLogin;
  // Starting at sign-in only makes sense while it can stay running in the background.
  $('bg-login').disabled = !p.keepRunning || !p.installed;
  $('bg-login').closest('.switch-row').classList.toggle('disabled', $('bg-login').disabled);
}
$('bg-keep').addEventListener('change', async () => {
  const p = await window.api.setPref('keepRunning', $('bg-keep').checked);
  renderBackground(p);
  toast(p.keepRunning ? 'Password Vault will keep running when you close the window' : 'Closing the window will quit Password Vault');
});
$('bg-login').addEventListener('change', async () => {
  const p = await window.api.setPref('openAtLogin', $('bg-login').checked);
  renderBackground(p);
  toast(p.openAtLogin ? 'Password Vault will open when you sign in' : "Password Vault won't open when you sign in");
});

// ---------- sync section in Settings ----------
function timeAgo(iso) {
  if (!iso) return 'not yet';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleString();
}

async function renderSync(status) {
  const s = status || (await window.api.syncStatus());
  $('sync-where').textContent = s.synced ? `Syncing via ${s.name}` : 'This computer only';
  $('sync-detail').textContent = s.synced
    ? `Last synced ${timeAgo(s.lastSync)} ·`
    : 'Turn on sync to use the same passwords on your other computers.';
  $('sync-path').textContent = s.folder;
  $('sync-path').title = s.folder;
  $('sync-path').classList.toggle('hidden', !s.synced);
  $('sync-open-folder').classList.toggle('hidden', !s.synced);
  $('sync-setup').textContent = s.synced ? 'Change folder' : 'Set up sync';
  $('sync-stop').classList.toggle('hidden', !s.synced);
  $('sync-how').classList.toggle('hidden', !s.synced);
  renderNotify();
}

// ---------- Notifications (Settings) ----------
async function renderNotify(state) {
  const s = state || (await window.api.notifyGet());
  document.querySelectorAll('[data-notify]').forEach((box) => (box.checked = !!s.prefs[box.dataset.notify]));
  // Password changes only come from other computers, so those switches need sync.
  document.querySelectorAll('.notify-change').forEach((row) => row.classList.toggle('hidden', !s.synced));
  $('notify-intro').textContent = s.synced
    ? 'Choose what Password Vault tells you about. Notifications still arrive while the window is closed or the vault is locked.'
    : 'Choose what Password Vault tells you about. Turn on sync to also hear about changes from your other computers.';
  $('notify-scope-wrap').classList.toggle('hidden', !s.synced);
  document.querySelectorAll('[data-scope]').forEach((b) => {
    const on = b.dataset.scope === s.scope;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('notify-scope-text').textContent =
    s.scope === 'all'
      ? 'Changes here apply to every computer that syncs this vault, unless a computer is set to “Only this computer”.'
      : 'These choices are for this computer only. Your other computers keep their own.';
}

const NOTIFY_NAMES = { added: 'new passwords', updated: 'changed passwords', deleted: 'deleted passwords', updates: 'app updates' };
document.querySelectorAll('[data-notify]').forEach((box) =>
  box.addEventListener('change', async () => {
    const s = await window.api.notifySet(box.dataset.notify, box.checked);
    if (s.locked) return;
    renderNotify(s);
    const where = s.synced && s.scope === 'all' ? ' on all your computers' : '';
    toast(`Notifications for ${NOTIFY_NAMES[box.dataset.notify]} ${box.checked ? 'on' : 'off'}${where}`);
  })
);
document.querySelectorAll('[data-scope]').forEach((b) =>
  b.addEventListener('click', async () => {
    const s = await window.api.notifyScope(b.dataset.scope);
    if (s.locked) return;
    renderNotify(s);
    toast(s.scope === 'all' ? 'These choices now apply to all your computers' : 'This computer now keeps its own choices');
  })
);
// Another computer added, edited (incl. icons) or deleted a login, or changed folders: say so inside the app too.
window.api.onRemoteChanges((msg) => {
  if (!$('app-screen').classList.contains('hidden')) toast(msg);
});

// Another computer changed the shared choices.
window.api.onNotifyChanged((s) => {
  if (!$('settings-pane').classList.contains('hidden')) renderNotify(s);
});
$('sync-setup').addEventListener('click', () => openSyncModal('enable'));
$('sync-open-folder').addEventListener('click', () => window.api.syncShowFolder());
$('sync-stop').addEventListener('click', async () => {
  const sure = await ask({
    title: 'Stop syncing?',
    text: 'A copy of your vault will be kept on this computer only. Your other computers keep using the copy in the cloud drive.',
    ok: 'Stop syncing',
    danger: true,
    input: false,
  });
  if (!sure) return;
  const res = await window.api.syncDisable();
  if (res.ok) {
    await renderSync(res.status);
    toast('Sync turned off on this computer');
  }
});

window.api.onSyncStatus((s) => {
  if (!$('settings-pane').classList.contains('hidden')) renderSync(s);
});

// Changes arrived from another computer.
// Fetch logins and folders together (folders can be empty, so they're stored separately).
let allFolders = [];
async function loadData() {
  [entries, allFolders] = await Promise.all([window.api.list(), window.api.folders()]);
}

async function refreshEntries() {
  await loadData();
  renderList();
  const editing = !$('edit-pane').classList.contains('hidden');
  if (selectedId && !entries.some((e) => e.id === selectedId)) {
    selectedId = null;
    if (!editing) showPane(null);
  } else if (selectedId && !$('view-pane').classList.contains('hidden')) {
    selectEntry(selectedId);
  }
}
window.api.onChanged(() => {
  if ($('app-screen').classList.contains('hidden')) return;
  refreshEntries();
});

// ---------- main app ----------
async function openApp() {
  hide($('lock-screen'));
  show($('app-screen'));
  await loadData();
  $('search').value = '';
  renderList();
  showPane(null);
}

function sortedFiltered() {
  const q = $('search').value.trim().toLowerCase();
  return entries
    .filter((e) => !q || [e.title, e.username, e.url, e.folder || ''].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

// ---------- login icons ----------
const BRANDS = window.BRAND_ICONS || [];
const brandById = new Map(BRANDS.map((b) => [b.id, b]));
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const brandByName = new Map(BRANDS.map((b) => [squash(b.title), b]));

// Without a chosen icon, show a known logo when the name or website matches one (e.g. "GitHub", "netflix.com").
function autoBrand(entry) {
  const byTitle = brandByName.get(squash(entry.title)) || brandById.get(squash(entry.title));
  if (byTitle) return byTitle;
  let host = '';
  try {
    host = new URL(/^https?:\/\//i.test(entry.url) ? entry.url : 'https://' + entry.url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const name = host.split('.').slice(-2, -1)[0];
  return name ? brandById.get(name) || brandByName.get(name) || null : null;
}

// Light brand colours (e.g. Snapchat yellow) get a dark logo; dark ones get a white logo.
function contrastOn(hex) {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#1a2213' : '#ffffff';
}

function brandTile(brand) {
  const div = document.createElement('div');
  div.className = 'avatar brand-logo';
  div.style.background = '#' + brand.hex;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', brand.path);
  p.setAttribute('fill', contrastOn(brand.hex));
  svg.appendChild(p);
  div.appendChild(svg);
  div.title = brand.title;
  return div;
}

/** The little picture for a login: chosen logo / emoji / image, else a matching logo, else the first letter. */
function avatarFor(entry, icon = entry.icon) {
  if (icon && icon.type === 'brand' && brandById.has(icon.id)) return brandTile(brandById.get(icon.id));
  if (icon && icon.type === 'emoji') {
    const div = document.createElement('div');
    div.className = 'avatar emoji';
    div.textContent = icon.value;
    return div;
  }
  if (icon && icon.type === 'image') {
    const div = document.createElement('div');
    div.className = 'avatar image';
    const img = document.createElement('img');
    img.src = icon.data;
    img.alt = '';
    div.appendChild(img);
    return div;
  }
  if (!icon || icon.type !== 'letter') {
    const auto = autoBrand(entry);
    if (auto) return brandTile(auto);
  }
  const div = document.createElement('div');
  div.className = 'avatar';
  div.textContent = ((entry.title || '').trim()[0] || '?').toUpperCase();
  return div;
}

// ---------- sidebar: logins, grouped into folders ----------
let collapsedFolders = new Set();
try {
  collapsedFolders = new Set(JSON.parse(localStorage.getItem('pv-collapsed-folders') || '[]'));
} catch {
  /* storage unavailable */
}
function saveCollapsed() {
  try {
    localStorage.setItem('pv-collapsed-folders', JSON.stringify([...collapsedFolders]));
  } catch {
    /* storage unavailable */
  }
}

const ICON = {
  folderPlus:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 10.5v5M9.5 13h5"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16 6l3 3M14 8l2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  open: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  out: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-2"/></svg>',
};

// ---------- floating menu (right-click, folder click, sidebar click) ----------
function popupMenu(x, y, items) {
  const menu = $('ctx-menu');
  menu.replaceChildren();
  for (const it of items) {
    if (it === '-') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
      continue;
    }
    if (it.label && !it.run) {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-label', textContent: it.label }));
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-option' + (it.danger ? ' danger' : '') + (it.selected ? ' selected' : '');
    b.setAttribute('role', 'menuitem');
    if (it.icon) b.insertAdjacentHTML('afterbegin', it.icon);
    if (it.depth) b.prepend(menuIndent(it.depth));
    b.appendChild(Object.assign(document.createElement('span'), { className: 'label', textContent: it.text }));
    if (it.selected) b.appendChild(Object.assign(document.createElement('span'), { className: 'check', textContent: '✓' }));
    b.addEventListener('click', () => {
      closeMenu();
      it.run();
    });
    menu.appendChild(b);
  }
  show(menu);
  // keep it on screen
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  const first = menu.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}
function closeMenu() {
  hide($('ctx-menu'));
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#ctx-menu')) closeMenu();
  if (!e.target.closest('.select-wrap')) closeFolderPicker();
});
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);
$('entry-list').addEventListener('scroll', closeMenu);

// ---------- small pop-up: name a folder / confirm ----------
// password: a hidden master-password field; validate may be async (the pop-up stays open while it shows an error);
// cancel: false for a notice with only one button.
function ask({ title, text, value = '', placeholder = '', ok, danger = false, input = true, password = false, cancel = 'Cancel', validate }) {
  return new Promise((resolve) => {
    $('ask-title').textContent = title;
    $('ask-text').textContent = text || '';
    $('ask-text').classList.toggle('hidden', !text);
    $('ask-input').classList.toggle('hidden', !input);
    $('ask-input').type = password ? 'password' : 'text';
    $('ask-input').maxLength = password ? 1024 : 60;
    $('ask-input').value = value;
    $('ask-input').placeholder = placeholder;
    $('ask-error').textContent = '';
    $('ask-ok').textContent = ok;
    $('ask-ok').disabled = false;
    $('ask-ok').classList.toggle('danger-fill', danger);
    $('ask-cancel').textContent = cancel || 'Cancel';
    $('ask-cancel').classList.toggle('hidden', cancel === false);
    show($('ask-modal'));
    if (input) {
      $('ask-input').focus();
      $('ask-input').select();
    } else $('ask-ok').focus();
    const finish = (val) => {
      hide($('ask-modal'));
      $('ask-form').onsubmit = null;
      $('ask-cancel').onclick = null;
      $('ask-input').value = '';
      askCancel = null;
      resolve(val);
    };
    askCancel = cancel === false ? null : () => finish(null);
    $('ask-cancel').onclick = () => finish(null);
    $('ask-form').onsubmit = async (e) => {
      e.preventDefault();
      if ($('ask-ok').disabled) return;
      const v = !input ? true : password ? $('ask-input').value : $('ask-input').value.trim();
      $('ask-ok').disabled = true;
      let err = null;
      try {
        err = validate ? await validate(v) : null;
      } finally {
        $('ask-ok').disabled = false;
      }
      if (err) {
        $('ask-error').textContent = err;
        if (password) $('ask-input').select();
        return;
      }
      finish(v);
    };
  });
}
let askCancel = null;
$('ask-modal').addEventListener('mousedown', (e) => {
  if (e.target === $('ask-modal') && askCancel) askCancel();
});

// ---------- folder actions ----------
const sameName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

// Folders can sit inside folders; each is known by its path, e.g. "Banking/Personal".
const SEP = '/';
const leafName = (p) => p.split(SEP).pop();
const parentOf = (p) => (p.includes(SEP) ? p.slice(0, p.lastIndexOf(SEP)) : '');
const depthOf = (p) => p.split(SEP).length - 1;
const insideOf = (p, folder) => p === folder || p.startsWith(folder + SEP);
const folderLabel = (p) => p.split(SEP).join(' › ');
const childPath = (parent, name) => (parent ? parent + SEP + name : name);
// Parents before children, each level alphabetical.
function treeOrder(paths) {
  return [...paths].sort((a, b) => {
    const x = a.split(SEP);
    const y = b.split(SEP);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const c = x[i].localeCompare(y[i], undefined, { sensitivity: 'base' });
      if (c) return c;
    }
    return x.length - y.length;
  });
}
const menuIndent = (depth) => Object.assign(document.createElement('span'), { className: 'menu-indent', style: `width:${depth * 14}px` });
// A folder name that would clash with another folder next to it.
const takenIn = (parent, name, except) => allFolders.some((f) => f !== except && parentOf(f) === parent && sameName(leafName(f), name));
const checkFolderName = (parent, except) => (v) =>
  !v ? 'Give the folder a name.' : v.includes(SEP) ? 'A folder name can’t contain “/”.' : takenIn(parent, v, except) ? 'There’s already a folder with that name here.' : null;

async function newFolder(thenMove, parent = '') {
  const name = await ask({
    title: parent ? `New folder inside “${leafName(parent)}”` : 'New folder',
    text: parent
      ? `It goes inside “${folderLabel(parent)}”. Drag logins or other folders onto it to add them.`
      : 'Group logins together, e.g. all your Google accounts. Drag logins (or other folders) onto the folder to add them.',
    placeholder: 'Folder name, e.g. Google accounts',
    ok: 'Create folder',
    validate: checkFolderName(parent),
  });
  if (!name) return null;
  const res = await window.api.addFolder(name, parent);
  if (res && res.locked) return null;
  collapsedFolders.delete(res);
  if (parent) collapsedFolders.delete(parent);
  saveCollapsed();
  if (thenMove) await window.api.moveToFolder(thenMove, res);
  await loadData();
  renderList();
  if (thenMove && selectedId === thenMove) selectEntry(thenMove);
  toast(thenMove ? `Moved to “${leafName(res)}”` : `Folder “${leafName(res)}” created`);
  return res;
}

// Keep folders open/closed as they were after a folder (and everything inside it) moves.
function remapCollapsed(from, to) {
  const moved = (f) => (to ? to + f.slice(from.length) : f.slice(from.length + 1));
  collapsedFolders = new Set([...collapsedFolders].map((f) => (insideOf(f, from) ? moved(f) : f)).filter(Boolean));
  saveCollapsed();
}

async function renameFolder(name) {
  const parent = parentOf(name);
  const to = await ask({
    title: 'Rename folder',
    value: leafName(name),
    ok: 'Rename',
    validate: checkFolderName(parent, name),
  });
  if (!to || to === leafName(name)) return;
  const res = await window.api.renameFolder(name, childPath(parent, to));
  if (res && res.locked) return;
  remapCollapsed(name, res);
  await loadData();
  renderList();
  if (selectedId) selectEntry(selectedId);
  toast(`Renamed to “${leafName(res)}”`);
}

async function moveFolder(name, parent) {
  if (parentOf(name) === parent || insideOf(parent, name)) return;
  if (takenIn(parent, leafName(name))) {
    const ok = await ask({
      title: `Combine with “${leafName(name)}”?`,
      text: `There’s already a folder called “${leafName(name)}” ${parent ? `in “${leafName(parent)}”` : 'at the top'}. Moving this one there combines the two.`,
      ok: 'Combine',
      input: false,
    });
    if (!ok) return;
  }
  const res = await window.api.moveFolder(name, parent);
  if (res && res.locked) return;
  remapCollapsed(name, res);
  if (parent) collapsedFolders.delete(parent);
  saveCollapsed();
  await loadData();
  renderList();
  if (selectedId) selectEntry(selectedId);
  toast(parent ? `Moved “${leafName(name)}” into “${leafName(parent)}”` : `Moved “${leafName(name)}” to the top`);
}

async function deleteFolder(name) {
  const n = entries.filter((e) => e.folder && insideOf(e.folder, name)).length;
  const subs = allFolders.filter((f) => f !== name && insideOf(f, name) && parentOf(f) === name).length;
  const parent = parentOf(name);
  const dest = parent ? `up into “${leafName(parent)}”` : subs ? 'to the top of the list' : 'out of the folder';
  const what = [n ? `${n} login${n === 1 ? '' : 's'}` : '', subs ? `${subs} folder${subs === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  const ok = await ask({
    title: `Delete “${leafName(name)}”?`,
    text: what ? `The folder is removed. Nothing in it is deleted: its ${what} move ${dest}.` : 'The folder is empty.',
    ok: 'Delete folder',
    danger: true,
    input: false,
  });
  if (!ok) return;
  const res = await window.api.deleteFolder(name);
  if (res && res.locked) return;
  collapsedFolders.delete(name);
  remapCollapsed(name, parent ? parent : '');
  await loadData();
  renderList();
  if (selectedId) selectEntry(selectedId);
  toast(`Folder “${leafName(name)}” deleted`);
}

function toggleFolder(name) {
  if (collapsedFolders.has(name)) collapsedFolders.delete(name);
  else collapsedFolders.add(name);
  saveCollapsed();
  renderList();
}

async function moveEntry(id, folder) {
  const e = entries.find((x) => x.id === id);
  if (!e || (e.folder || '') === folder) return;
  const res = await window.api.moveToFolder(id, folder);
  if (res && res.locked) return;
  if (folder) collapsedFolders.delete(folder);
  saveCollapsed();
  await loadData();
  renderList();
  if (selectedId === id) selectEntry(id);
  toast(folder ? `Moved “${e.title}” to “${leafName(folder)}”` : `Moved “${e.title}” out of its folder`);
}

function addPassword(folder) {
  closeMenu();
  selectedId = null;
  renderList();
  openEditor(null);
  setEditorFolder(folder || '');
  if (!$('e-password').value) generateInto();
}

function folderMenuItems(name) {
  const collapsed = collapsedFolders.has(name);
  const leaf = leafName(name);
  const parent = parentOf(name);
  const items = [
    { label: folderLabel(name) },
    { text: 'Rename folder…', icon: ICON.pen, run: () => renameFolder(name) },
    { text: 'Delete folder…', icon: ICON.trash, danger: true, run: () => deleteFolder(name) },
    '-',
    { text: `Add a password to “${leaf}”`, icon: ICON.plus, run: () => addPassword(name) },
    { text: `New folder inside “${leaf}”…`, icon: ICON.folderPlus, run: () => newFolder(null, name) },
    { text: collapsed ? 'Open folder' : 'Close folder', icon: ICON.open, run: () => toggleFolder(name) },
  ];
  if (parent) items.push({ text: `Move out of “${leafName(parent)}”`, icon: ICON.out, run: () => moveFolder(name, parentOf(parent)) });
  return items;
}

function entryMenuItems(entry) {
  const items = [
    { label: entry.title },
    { text: 'Open', icon: ICON.key, run: () => selectEntry(entry.id) },
    { text: 'Edit', icon: ICON.pen, run: () => editLogin(entry) },
    { text: 'Remind me…', icon: ICON.bell, run: () => openReminder(entry) },
    { text: 'Delete…', icon: ICON.trash, danger: true, run: () => deleteLogin(entry) },
    '-',
    { label: 'Move to folder' },
  ];
  for (const f of treeOrder(allFolders))
    items.push({ text: leafName(f), depth: depthOf(f), icon: ICON.folder, selected: entry.folder === f, run: () => moveEntry(entry.id, f) });
  items.push({ text: 'New folder…', icon: ICON.folderPlus, run: () => newFolder(entry.id) });
  if (entry.folder) items.push('-', { text: 'Remove from folder', icon: ICON.out, run: () => moveEntry(entry.id, '') });
  return items;
}

function sidebarMenuItems() {
  return [
    { text: 'New folder…', icon: ICON.folderPlus, run: () => newFolder() },
    { text: 'Add a password', icon: ICON.plus, run: () => addPassword('') },
  ];
}

// ---------- drag & drop ----------
let draggingId = null; // a login being dragged
let draggingFolder = null; // or a folder being dragged
function clearDropMarks() {
  document.querySelectorAll('#entry-list .drop-target').forEach((el) => el.classList.remove('drop-target'));
  $('entry-list').classList.remove('drop-unfiled');
}
// Where a drop over `target` would put the login / folder: a folder path, '' for "no folder", or null.
function dropFolderFor(target) {
  const row = target.closest('#entry-list li');
  let folder = null;
  if (row && row.dataset.folder !== undefined) folder = row.dataset.folder;
  else if (target.closest('#entry-list')) folder = '';
  // A folder can't go inside itself, and dropping it where it already is does nothing.
  if (draggingFolder && folder !== null && (insideOf(folder, draggingFolder) || parentOf(draggingFolder) === folder)) return null;
  return folder;
}
$('entry-list').addEventListener('dragover', (e) => {
  if (!draggingId && !draggingFolder) return;
  const folder = dropFolderFor(e.target);
  if (folder === null) return clearDropMarks();
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  if (folder) {
    const head = document.querySelector(`#entry-list .folder-head[data-folder="${CSS.escape(folder)}"]`);
    if (head) head.classList.add('drop-target');
  } else {
    $('entry-list').classList.add('drop-unfiled');
  }
});
$('entry-list').addEventListener('dragleave', (e) => {
  if (!e.relatedTarget || !$('entry-list').contains(e.relatedTarget)) clearDropMarks();
});
$('entry-list').addEventListener('drop', (e) => {
  e.preventDefault();
  const folder = dropFolderFor(e.target);
  const id = draggingId;
  const moving = draggingFolder;
  clearDropMarks();
  if (folder === null) return;
  if (id) moveEntry(id, folder);
  else if (moving) moveFolder(moving, folder);
});

// ---------- sidebar rows ----------
function entryRow(entry, inFolder) {
  const li = document.createElement('li');
  if (entry.id === selectedId) li.classList.add('active');
  if (inFolder) {
    li.classList.add('in-folder');
    li.style.setProperty('--depth', depthOf(entry.folder));
  }
  li.dataset.folder = entry.folder || '';
  li.draggable = true;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = entry.title;
  const u = document.createElement('div');
  u.className = 'u';
  u.textContent = entry.username || entry.url || '';
  meta.append(t, u);
  // Quick Edit / Delete buttons, shown on hover and on the open login.
  const actions = Object.assign(document.createElement('span'), { className: 'row-actions' });
  actions.append(
    rowButton(ICON.pen, `Edit “${entry.title}”`, () => editLogin(entry)),
    rowButton(ICON.trash, `Delete “${entry.title}”`, () => deleteLogin(entry), true)
  );
  li.append(avatarFor(entry), meta, actions);
  li.addEventListener('click', () => selectEntry(entry.id));
  li.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    popupMenu(e.clientX, e.clientY, entryMenuItems(entry));
  });
  li.addEventListener('dragstart', (e) => {
    draggingId = entry.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', entry.title);
    closeMenu();
    requestAnimationFrame(() => li.classList.add('dragging'));
  });
  li.addEventListener('dragend', () => {
    draggingId = null;
    li.classList.remove('dragging');
    clearDropMarks();
  });
  return li;
}

// A small icon button inside a sidebar row (doesn't open the row or start a drag).
function rowButton(icon, title, run, danger = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'row-btn' + (danger ? ' danger' : '');
  b.title = title;
  b.setAttribute('aria-label', title);
  b.draggable = false;
  b.innerHTML = icon;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenu();
    run();
  });
  b.addEventListener('mousedown', (e) => e.stopPropagation());
  return b;
}

function folderHeader(name, count, collapsed) {
  const li = document.createElement('li');
  const depth = depthOf(name);
  li.className = 'folder-head' + (collapsed ? ' collapsed' : '') + (depth ? ' nested' : '');
  if (depth) li.style.setProperty('--depth', depth);
  li.dataset.folder = name;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-expanded', String(!collapsed));
  li.title = 'Click for options · drag logins or folders here · drag to move';
  li.draggable = true;
  li.addEventListener('dragstart', (e) => {
    draggingFolder = name;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leafName(name));
    closeMenu();
    requestAnimationFrame(() => li.classList.add('dragging'));
  });
  li.addEventListener('dragend', () => {
    draggingFolder = null;
    li.classList.remove('dragging');
    clearDropMarks();
  });
  const chev = document.createElement('span');
  chev.className = 'chev-btn';
  chev.title = collapsed ? 'Open folder' : 'Close folder';
  chev.innerHTML =
    '<svg class="chev" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  chev.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFolder(name);
  });
  li.appendChild(chev);
  li.insertAdjacentHTML(
    'beforeend',
    '<svg class="folder-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>'
  );
  const label = Object.assign(document.createElement('span'), { className: 'folder-name', textContent: leafName(name) });
  const add = Object.assign(document.createElement('span'), { className: 'add-here', textContent: '+', title: `Add a password to “${leafName(name)}”` });
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    addPassword(name);
  });
  const c = Object.assign(document.createElement('span'), { className: 'count', textContent: count });
  const actions = Object.assign(document.createElement('span'), { className: 'row-actions' });
  actions.append(
    rowButton(ICON.pen, `Rename “${leafName(name)}”`, () => renameFolder(name)),
    rowButton(ICON.trash, `Delete “${leafName(name)}”`, () => deleteFolder(name), true)
  );
  li.append(label, add, c, actions);
  // Click (or right-click) the folder for its menu: add a password here, open/close, rename, delete.
  const menu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    popupMenu(e.clientX, e.clientY, folderMenuItems(name));
  };
  li.addEventListener('click', menu);
  li.addEventListener('contextmenu', menu);
  return li;
}

function folderNames() {
  return allFolders;
}

function renderList() {
  const list = $('entry-list');
  list.replaceChildren();
  const items = sortedFiltered();
  const searching = !!$('search').value.trim();
  if (items.length === 0 && (searching || !allFolders.length)) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = entries.length ? 'No matches.' : 'No passwords saved yet.';
    list.appendChild(li);
    return;
  }
  // Folders first (alphabetical, including empty ones, each with its folders then its logins inside),
  // then logins that aren't in a folder.
  const groups = new Map();
  for (const e of items) {
    const f = e.folder || '';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(e);
  }
  const used = [...groups.keys()].filter(Boolean);
  const names = new Set(searching ? used : [...allFolders, ...used]);
  for (const n of [...names]) for (let p = parentOf(n); p; p = parentOf(p)) names.add(p); // the folders above
  const children = new Map();
  for (const n of treeOrder(names)) {
    const p = parentOf(n);
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n);
  }
  const selected = current();
  const countIn = (name) => items.filter((e) => e.folder && insideOf(e.folder, name)).length;
  const addFolder = (name) => {
    const group = groups.get(name) || [];
    const subs = children.get(name) || [];
    // Searching opens every folder; a folder holding the open login stays open too.
    const holdsSelected = selected && selected.folder && insideOf(selected.folder, name);
    const collapsed = !searching && collapsedFolders.has(name) && !holdsSelected;
    list.appendChild(folderHeader(name, countIn(name), collapsed));
    if (collapsed) return;
    for (const sub of subs) addFolder(sub);
    for (const e of group) list.appendChild(entryRow(e, true));
    if (!group.length && !subs.length) {
      const empty = Object.assign(document.createElement('li'), { className: 'folder-empty', textContent: 'Empty — drag logins here' });
      empty.dataset.folder = name;
      empty.style.setProperty('--depth', depthOf(name));
      list.appendChild(empty);
    }
  };
  for (const top of children.get('') || []) addFolder(top);
  for (const e of groups.get('') || []) list.appendChild(entryRow(e, false));
}

// Right-click on empty space in the sidebar: New folder / Add a password.
// (A left-click anywhere just closes the menu — see the mousedown handler above.)
function sidebarMenu(e) {
  if (e.target.closest('li, button, input')) return;
  e.preventDefault();
  popupMenu(e.clientX, e.clientY, sidebarMenuItems());
}
$('entry-list').addEventListener('contextmenu', sidebarMenu);
document.querySelector('.sidebar .nav-label').addEventListener('contextmenu', sidebarMenu);
$('new-folder-btn').addEventListener('click', () => newFolder());

function showPane(name) {
  for (const id of ['empty-state', 'view-pane', 'edit-pane', 'settings-pane']) hide($(id));
  show($(name || 'empty-state'));
}

function current() {
  return entries.find((e) => e.id === selectedId);
}

let shownLoginId = null;
function selectEntry(id) {
  selectedId = id;
  renderList();
  const e = current();
  if (!e) return showPane(null);
  $('v-title').textContent = e.title;
  $('v-icon').replaceChildren(avatarFor(e));
  const eyebrow = $('v-eyebrow');
  eyebrow.replaceChildren(document.createTextNode('Login'));
  if (e.folder) {
    const chip = document.createElement('span');
    chip.className = 'folder-chip';
    chip.textContent = folderLabel(e.folder);
    chip.title = 'Folder';
    eyebrow.append(document.createTextNode(' · '), chip);
  }
  $('v-username').textContent = e.username || '—';
  $('v-password').textContent = '••••••••••••';
  $('v-password').dataset.revealed = '';
  $('reveal-btn').textContent = 'Show';
  $('v-url').textContent = e.url;
  $('v-url-field').classList.toggle('hidden', !e.url);
  const rich = RichNotes.richFor(e);
  const notesView = $('v-notes');
  notesView.classList.toggle('rich', !!rich);
  if (rich) notesView.innerHTML = rich; // already cleaned: only formatting tags survive
  else notesView.textContent = e.notes;
  $('v-notes-field').classList.toggle('hidden', !e.notes && !rich);
  renderViewFiles(e);
  $('v-meta').textContent = `Last updated ${new Date(e.updatedAt).toLocaleString()}`;
  if (shownLoginId !== e.id) $('v-reminders').classList.add('hidden'); // until this login's reminders load
  shownLoginId = e.id;
  renderReminders();
  showPane('view-pane');
}

$('reveal-btn').addEventListener('click', () => {
  const e = current();
  const el = $('v-password');
  const revealed = !el.dataset.revealed;
  el.dataset.revealed = revealed ? '1' : '';
  el.textContent = revealed ? e.password : '••••••••••••';
  $('reveal-btn').textContent = revealed ? 'Hide' : 'Show';
});

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const e = current();
    const field = btn.dataset.copy;
    if (!e || !e[field]) return toast('Nothing to copy');
    const secs = await window.api.copy(e[field]);
    toast(field === 'password' ? `Password copied — clears in ${secs}s` : 'Copied');
  });
});

$('open-url-btn').addEventListener('click', () => {
  const e = current();
  if (e && e.url) window.api.openUrl(e.url);
});

$('search').addEventListener('input', renderList);

// ---------- add / edit ----------
function openEditor(entry) {
  editingId = entry ? entry.id : null;
  $('e-heading').textContent = entry ? 'Edit entry' : 'New entry';
  $('e-title').value = entry ? entry.title : '';
  $('e-username').value = entry ? entry.username : '';
  $('e-password').value = entry ? entry.password : '';
  $('e-password').type = 'password';
  $('e-reveal').textContent = 'Show';
  $('e-url').value = entry ? entry.url : '';
  $('e-notes').innerHTML = (entry && RichNotes.richFor(entry)) || RichNotes.fromPlain(entry ? entry.notes : '');
  updateToolbar();
  resetEditorReminders();
  editorFiles = entry && entry.attachments ? entry.attachments.map((f) => ({ ...f })) : [];
  renderEditorFiles();
  setEditorFolder(entry ? entry.folder || '' : '');
  closeFolderPicker();
  editingIcon = entry ? entry.icon || null : null;
  updateEditorIcon();
  updateStrength();
  showPane('edit-pane');
  $('e-title').focus();
}

// ---------- formatted notes: the toolbar ----------
// (The cleaning, tables and colours live in notes-editor.js.)
const notesEd = $('e-notes');
let notesRange = null; // the selection in the notes, kept while a toolbar menu has the focus
function rememberNotesSelection() {
  const sel = getSelection();
  if (sel.rangeCount && notesEd.contains(sel.getRangeAt(0).commonAncestorContainer)) notesRange = sel.getRangeAt(0).cloneRange();
}
function focusNotes() {
  notesEd.focus();
  if (notesRange && notesEd.contains(notesRange.commonAncestorContainer)) {
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(notesRange);
  }
}
function runNotes(cmd, value = null) {
  focusNotes();
  document.execCommand('styleWithCSS', false, false);
  document.execCommand(cmd, false, value);
  rememberNotesSelection();
  updateToolbar();
}
const nodeEl = (n) => (n && n.nodeType === 1 ? n : n && n.parentElement);
function notesCell() {
  const r = document.activeElement === notesEd && getSelection().rangeCount ? getSelection().getRangeAt(0) : notesRange;
  const el = r && nodeEl(r.startContainer);
  const td = el && el.closest('td');
  return td && notesEd.contains(td) ? td : null;
}
function updateToolbar() {
  const inNotes = document.activeElement === notesEd;
  for (const b of document.querySelectorAll('#notes-toolbar [data-cmd]')) {
    let on = false;
    if (inNotes && b.dataset.cmd !== 'removeFormat') {
      try {
        on = document.queryCommandState(b.dataset.cmd);
      } catch {
        on = false;
      }
    }
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
  // text size: the nearest size set around the cursor
  let size = '3';
  const r = inNotes && getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
  const f = r && nodeEl(r.startContainer) && nodeEl(r.startContainer).closest('font[size]');
  if (f && notesEd.contains(f)) size = f.getAttribute('size');
  const s = RichNotes.SIZES.find((x) => x[1] === size);
  $('tb-size-label').textContent = s ? s[0] : size > '3' ? 'Huge' : 'Small';
}
document.addEventListener('selectionchange', () => {
  if (document.activeElement !== notesEd) return;
  rememberNotesSelection();
  updateToolbar();
});
notesEd.addEventListener('blur', () => setTimeout(updateToolbar, 0));

// Clicking the toolbar keeps the cursor in the notes.
$('notes-toolbar').addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) e.preventDefault();
});
const swatch = (cls) => `<span class="swatch ${cls}"></span>`;
const btnPos = (b) => {
  const r = b.getBoundingClientRect();
  return [r.left, r.bottom + 4];
};
$('notes-toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.cmd) return runNotes(b.dataset.cmd);
  rememberNotesSelection();
  const [x, y] = btnPos(b);
  if (b.dataset.menu === 'size') {
    const current = $('tb-size-label').textContent;
    popupMenu(x, y, RichNotes.SIZES.map(([text, v]) => ({ text, selected: text === current, run: () => runNotes('fontSize', v) })));
  } else if (b.dataset.menu === 'highlight') {
    popupMenu(x, y, [
      ...RichNotes.HIGHLIGHTS.map(([text, hex]) => ({ text, icon: swatch('sw-' + text.toLowerCase()), run: () => runNotes('hiliteColor', hex) })),
      '-',
      { text: 'No highlight', icon: swatch('sw-none'), run: () => runNotes('hiliteColor', 'transparent') },
    ]);
  } else if (b.dataset.menu === 'colour') {
    popupMenu(x, y, RichNotes.COLOURS.map(([text, hex]) => ({ text, icon: swatch('tc-' + text.toLowerCase()), run: () => runNotes('foreColor', hex) })));
  } else if (b.dataset.menu === 'table') {
    const td = notesCell();
    if (!td) return openTablePicker(x, y);
    const edit = (fn) => () => {
      focusNotes();
      const next = fn(td);
      placeCaret(next && next.isConnected ? next : td.isConnected ? td : null);
      notesEd.dispatchEvent(new Event('input'));
    };
    popupMenu(x, y, [
      { label: 'Table' },
      { text: 'Insert row above', icon: ICON.plus, run: edit((c) => RichNotes.addRow(c, false)) },
      { text: 'Insert row below', icon: ICON.plus, run: edit((c) => RichNotes.addRow(c, true)) },
      { text: 'Insert column left', icon: ICON.plus, run: edit((c) => RichNotes.addColumn(c, false)) },
      { text: 'Insert column right', icon: ICON.plus, run: edit((c) => RichNotes.addColumn(c, true)) },
      '-',
      { text: 'Delete row', icon: ICON.trash, danger: true, run: edit((c) => RichNotes.deleteRow(c)) },
      { text: 'Delete column', icon: ICON.trash, danger: true, run: edit((c) => RichNotes.deleteColumn(c)) },
      { text: 'Delete table', icon: ICON.trash, danger: true, run: edit((c) => c.closest('table').remove()) },
      '-',
      { text: 'Insert another table…', icon: ICON.plus, run: () => openTablePicker(x, y) },
    ]);
  }
});

// Put the cursor at the start of a table cell (or back in the notes).
function placeCaret(td) {
  notesEd.focus();
  const sel = getSelection();
  const r = document.createRange();
  if (td) {
    r.selectNodeContents(td);
    r.collapse(true);
  } else {
    r.selectNodeContents(notesEd);
    r.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(r);
  rememberNotesSelection();
  updateToolbar();
}

// Table size picker: hover over the grid, click to insert.
const GRID_ROWS = 6;
const GRID_COLS = 8;
(() => {
  const grid = $('table-grid');
  for (let r = 1; r <= GRID_ROWS; r++)
    for (let c = 1; c <= GRID_COLS; c++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.r = r;
      b.dataset.c = c;
      b.setAttribute('aria-label', `${r} by ${c} table`);
      grid.appendChild(b);
    }
  const mark = (r, c) => {
    for (const b of grid.children) b.classList.toggle('on', +b.dataset.r <= r && +b.dataset.c <= c);
    $('table-size').textContent = r ? `${r} × ${c} table` : 'Insert a table';
  };
  grid.addEventListener('mouseover', (e) => e.target.dataset.r && mark(+e.target.dataset.r, +e.target.dataset.c));
  grid.addEventListener('focusin', (e) => e.target.dataset.r && mark(+e.target.dataset.r, +e.target.dataset.c));
  grid.addEventListener('mouseleave', () => mark(0, 0));
  grid.addEventListener('mousedown', (e) => e.preventDefault());
  grid.addEventListener('click', (e) => {
    if (!e.target.dataset.r) return;
    closeTablePicker();
    insertTable(+e.target.dataset.r, +e.target.dataset.c);
  });
})();
function openTablePicker(x, y) {
  closeMenu();
  const p = $('table-picker');
  for (const b of $('table-grid').children) b.classList.remove('on');
  $('table-size').textContent = 'Insert a table';
  show(p);
  const r = p.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  p.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
}
function closeTablePicker() {
  hide($('table-picker'));
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#table-picker') && !e.target.closest('[data-menu="table"]')) closeTablePicker();
});
function insertTable(rows, cols) {
  focusNotes();
  const before = new Set(notesEd.querySelectorAll('table'));
  document.execCommand('insertHTML', false, RichNotes.tableHtml(rows, cols));
  const table = [...notesEd.querySelectorAll('table')].find((t) => !before.has(t));
  placeCaret(table ? table.querySelector('td') : null);
}

// Tab / Shift+Tab move between table cells (Tab in the last cell adds a row). Ctrl+Shift+X: strikethrough.
notesEd.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
    e.preventDefault();
    return runNotes('strikeThrough');
  }
  if (e.key !== 'Tab') return;
  const td = notesCell();
  if (!td) return;
  e.preventDefault();
  const cells = [...td.closest('table').querySelectorAll('td')];
  const i = cells.indexOf(td);
  if (e.shiftKey) return i > 0 && placeCaret(cells[i - 1]);
  if (i < cells.length - 1) return placeCaret(cells[i + 1]);
  placeCaret(RichNotes.addRow(td, true));
  notesEd.dispatchEvent(new Event('input'));
});

// Pasting (from Word, Outlook, a web page…) keeps simple formatting and drops everything else.
notesEd.addEventListener('paste', (e) => {
  const pictures = [...e.clipboardData.files].filter(isPicture);
  if (pictures.length) {
    e.preventDefault();
    return insertPictures(pictures);
  }
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  e.preventDefault();
  if (html) document.execCommand('insertHTML', false, RichNotes.sanitize(html));
  else if (text) document.execCommand('insertText', false, text);
});
// Text dragged in from elsewhere is cleaned the same way (moving text within the notes is left alone).
let draggingInNotes = false;
notesEd.addEventListener('dragstart', () => (draggingInNotes = true));
notesEd.addEventListener('dragend', () => (draggingInNotes = false));
notesEd.addEventListener('drop', (e) => {
  if (draggingInNotes) return;
  const dropped = e.dataTransfer ? [...e.dataTransfer.files] : [];
  if (dropped.length) {
    // Pictures go into the notes where they're dropped; other files are attached to the login.
    e.preventDefault();
    const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (pos && notesEd.contains(pos.startContainer)) notesRange = pos;
    const pictures = dropped.filter(isPicture);
    if (pictures.length) insertPictures(pictures);
    const others = dropped.filter((f) => !isPicture(f));
    if (others.length) addFiles(others);
    return;
  }
  const html = e.dataTransfer && e.dataTransfer.getData('text/html');
  if (html) e.preventDefault();
  if (html) {
    const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (pos) {
      getSelection().removeAllRanges();
      getSelection().addRange(pos);
    }
    document.execCommand('insertHTML', false, RichNotes.sanitize(html));
  }
});

// ---------- pictures in notes ----------
// Made smaller (at most 1600 pixels across) and stored inside the note, encrypted with the rest of the vault.
const isPicture = (f) => /^image\/(png|jpeg|gif|webp|bmp)$/.test(f.type);
async function pictureDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  let url = c.toDataURL('image/webp', 0.85);
  if (url.length > 2.5e6) url = c.toDataURL('image/webp', 0.6);
  return url;
}
async function insertPictures(files) {
  for (const f of files) {
    try {
      const url = await pictureDataUrl(f);
      focusNotes();
      document.execCommand('insertHTML', false, `<img src="${url}" data-size="m" alt="">`);
      rememberNotesSelection();
    } catch {
      toast(`“${f.name}” couldn’t be opened as a picture`);
    }
  }
}
$('tb-picture').addEventListener('click', () => {
  rememberNotesSelection();
  $('e-picture-input').click();
});
$('e-picture-input').addEventListener('change', () => {
  const files = [...$('e-picture-input').files];
  $('e-picture-input').value = '';
  if (files.length) insertPictures(files);
});
// Click a picture in the notes: change its size, save it, or remove it.
notesEd.addEventListener('click', (e) => {
  const img = e.target.closest('img');
  if (!img) return;
  const r = document.createRange();
  r.selectNode(img);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  notesRange = r.cloneRange();
  const size = img.getAttribute('data-size') || 'm';
  const setSize = (s) => () => {
    img.setAttribute('data-size', s);
    notesEd.dispatchEvent(new Event('input'));
  };
  popupMenu(e.clientX, e.clientY, [
    { label: 'Picture' },
    { text: 'Small', selected: size === 's', run: setSize('s') },
    { text: 'Medium', selected: size === 'm', run: setSize('m') },
    { text: 'Full width', selected: size === 'l', run: setSize('l') },
    '-',
    { text: 'Save picture…', icon: ICON.out, run: () => savePicture(img) },
    { text: 'Remove picture', icon: ICON.trash, danger: true, run: () => runNotes('delete') },
  ]);
});
async function savePicture(img) {
  const res = await window.api.savePicture(img.getAttribute('src'), (current() && current().title) || 'Picture');
  if (res.ok) toast('Picture saved');
  else if (res.error) toast(res.error);
}
// When viewing a login: click a picture to save it.
$('v-notes').addEventListener('click', (e) => {
  const img = e.target.closest('img');
  if (img) popupMenu(e.clientX, e.clientY, [{ text: 'Save picture…', icon: ICON.out, run: () => savePicture(img) }]);
});

// ---------- files attached to a login ----------
const MAX_FILE = 10 * 1024 * 1024;
const MAX_LOGIN_FILES = 25 * 1024 * 1024;
let editorFiles = []; // in the editor: { id, name, type, size, data? (new ones only) }
const fileSize = (n) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const FILE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l5 5v13H6Z"/><path d="M14 3v5h5"/></svg>';
function fileRow(f, buttons) {
  const li = document.createElement('li');
  li.insertAdjacentHTML('afterbegin', FILE_ICON);
  const body = Object.assign(document.createElement('div'), { className: 'file-body' });
  body.append(
    Object.assign(document.createElement('div'), { className: 'file-name', textContent: f.name, title: f.name }),
    Object.assign(document.createElement('div'), { className: 'file-size', textContent: fileSize(f.size) + (f.data ? ' · new' : '') })
  );
  li.append(body);
  for (const [text, run, cls] of buttons.filter(Boolean)) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'reminder-cancel' + (cls ? ' ' + cls : ''), textContent: text });
    b.addEventListener('click', run);
    li.append(b);
  }
  return li;
}
function renderEditorFiles() {
  $('e-file-list').replaceChildren(
    ...editorFiles.map((f) =>
      fileRow(f, [
        [
          'Remove',
          () => {
            editorFiles = editorFiles.filter((x) => x !== f);
            renderEditorFiles();
          },
        ],
      ])
    )
  );
  $('e-file-list').classList.toggle('hidden', !editorFiles.length);
}
const readBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
async function addFiles(files) {
  for (const f of files) {
    const total = editorFiles.reduce((n, x) => n + x.size, 0);
    if (f.size > MAX_FILE) {
      toast(`“${f.name}” is too big. Files can be up to 10 MB.`);
      continue;
    }
    if (total + f.size > MAX_LOGIN_FILES) {
      toast('The files on one login can add up to 25 MB at most.');
      break;
    }
    try {
      editorFiles.push({ id: 'new-' + Math.random().toString(36).slice(2), name: f.name, type: f.type, size: f.size, data: await readBase64(f) });
    } catch {
      toast(`“${f.name}” couldn’t be read`);
    }
  }
  renderEditorFiles();
}
$('e-file-add').addEventListener('click', () => $('e-file-input').click());
$('e-file-input').addEventListener('change', () => {
  const files = [...$('e-file-input').files];
  $('e-file-input').value = '';
  if (files.length) addFiles(files);
});
// Everyday documents and pictures can be opened; anything else (e.g. programs) can only be saved.
const OPENABLE = /\.(pdf|txt|csv|md|rtf|png|jpe?g|gif|webp|bmp|heic|tiff?|docx?|xlsx?|pptx?|odt|ods|odp|pages|numbers|key)$/i;
function renderViewFiles(e) {
  const files = e.attachments || [];
  $('v-file-list').replaceChildren(
    ...files.map((f) =>
      fileRow(f, [
        OPENABLE.test(f.name) && [
          'Open',
          async () => {
            const res = await window.api.openFile(e.id, f.id);
            if (res.notOpenable) toast('This kind of file can’t be opened from Password Vault. Use Save instead.');
            else if (!res.ok && res.error) toast(res.error);
          },
        ],
        [
          'Save…',
          async () => {
            const res = await window.api.saveFile(e.id, f.id);
            if (res.ok) toast(`Saved “${f.name}”`);
            else if (res.error) toast(res.error);
          },
          'primary',
        ],
      ])
    )
  );
  $('v-files-field').classList.toggle('hidden', !files.length);
}

// ---------- folder picker in the editor (styled to match the app) ----------
function setEditorFolder(name) {
  $('e-folder').value = name || '';
  $('folder-trigger-label').textContent = name ? folderLabel(name) : 'No folder';
  $('folder-trigger').classList.toggle('no-folder', !name); // (not "empty": that class is the welcome screen's)
}

function closeFolderPicker() {
  hide($('folder-menu'));
  $('folder-trigger').classList.remove('open');
  $('folder-trigger').setAttribute('aria-expanded', 'false');
}

function openFolderPicker() {
  const menu = $('folder-menu');
  menu.replaceChildren();
  const current = $('e-folder').value;
  const option = (text, value, icon, depth = 0) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-option' + (value === current ? ' selected' : '');
    b.setAttribute('role', 'option');
    b.insertAdjacentHTML('afterbegin', icon);
    if (depth) b.prepend(menuIndent(depth));
    b.appendChild(Object.assign(document.createElement('span'), { className: 'label', textContent: text }));
    b.appendChild(Object.assign(document.createElement('span'), { className: 'check', textContent: '✓' }));
    b.addEventListener('click', () => {
      setEditorFolder(value);
      closeFolderPicker();
    });
    return b;
  };
  menu.appendChild(option('No folder', '', ICON.out));
  // folders the vault knows about, plus one typed for this login that isn't saved yet
  const names = new Set([...allFolders, ...(current ? [current] : [])]);
  for (const n of [...names]) for (let p = parentOf(n); p; p = parentOf(p)) names.add(p);
  if (names.size) menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
  for (const f of treeOrder(names)) menu.appendChild(option(leafName(f), f, ICON.folder, depthOf(f)));
  menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
  const nb = document.createElement('button');
  nb.type = 'button';
  nb.className = 'menu-option';
  nb.insertAdjacentHTML('afterbegin', ICON.folderPlus);
  nb.appendChild(Object.assign(document.createElement('span'), { className: 'label', textContent: 'New folder…' }));
  nb.addEventListener('click', async () => {
    closeFolderPicker();
    const name = await ask({
      title: 'New folder',
      text: 'This login will go in the new folder when you save.',
      placeholder: 'Folder name, e.g. Google accounts',
      ok: 'Use this folder',
      validate: (v) => (!v ? 'Give the folder a name.' : null),
    });
    if (!name) return;
    const existing = allFolders.find((f) => sameName(f, name));
    setEditorFolder(existing || name);
  });
  menu.appendChild(nb);
  show(menu);
  $('folder-trigger').classList.add('open');
  $('folder-trigger').setAttribute('aria-expanded', 'true');
  const sel = menu.querySelector('.selected') || menu.querySelector('button');
  if (sel) sel.focus({ preventScroll: true });
}

$('folder-trigger').addEventListener('click', () => ($('folder-menu').classList.contains('hidden') ? openFolderPicker() : closeFolderPicker()));
$('folder-menu').addEventListener('keydown', (e) => {
  const opts = [...$('folder-menu').querySelectorAll('button')];
  const i = opts.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') opts[Math.min(i + 1, opts.length - 1)].focus();
  else if (e.key === 'ArrowUp') opts[Math.max(i - 1, 0)].focus();
  else if (e.key === 'Escape') {
    e.stopPropagation();
    closeFolderPicker();
    $('folder-trigger').focus();
  } else return;
  e.preventDefault();
});
$('ctx-menu').addEventListener('keydown', (e) => {
  const opts = [...$('ctx-menu').querySelectorAll('button')];
  const i = opts.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') opts[Math.min(i + 1, opts.length - 1)].focus();
  else if (e.key === 'ArrowUp') opts[Math.max(i - 1, 0)].focus();
  else if (e.key === 'Escape') closeMenu();
  else return;
  e.preventDefault();
});

// ---------- icon picker ----------
let editingIcon = null; // icon chosen in the editor (null = automatic)
const editorEntry = () => ({ title: $('e-title').value, url: $('e-url').value });
function updateEditorIcon() {
  $('e-icon').replaceChildren(avatarFor(editorEntry(), editingIcon));
}
$('e-title').addEventListener('input', updateEditorIcon);
$('e-url').addEventListener('input', updateEditorIcon);

const EMOJIS = '🔐 🔑 🗝️ 🛡️ 🔒 💳 🏦 💰 💵 🪙 📈 🧾 🛒 🛍️ 📦 🍔 🍕 ☕ 🎮 🎧 🎵 🎬 📺 📷 📱 💻 🖥️ ⌚ 🖨️ ☁️ 📧 💬 📞 🌐 🏠 🏢 🏫 🏥 🚗 ✈️ 🚆 🏨 🗺️ 🎓 📚 📝 🗂️ 📁 🧰 🛠️ ⚙️ 🧪 💼 👔 👨‍💻 👩‍💻 ❤️ ⭐ 🔥 ⚡ 🌱 🐾 🎁 🎉 🏆 ⚽ 🏀 🎾 🧘 💊 🩺 👶 👪'.split(' ');

function iconTab(name) {
  document.querySelectorAll('.icon-tabs .toggle-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.icon-tab').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  if (name === 'logos') $('logo-search').focus();
  if (name === 'emoji') $('emoji-input').focus();
}
document.querySelectorAll('.icon-tabs .toggle-btn').forEach((b) => b.addEventListener('click', () => iconTab(b.dataset.tab)));

function chooseIcon(icon) {
  editingIcon = icon;
  updateEditorIcon();
  hide($('icon-modal'));
}

function renderLogoGrid() {
  const q = squash($('logo-search').value);
  const grid = $('logo-grid');
  grid.replaceChildren();
  const list = BRANDS.filter((b) => !q || squash(b.title).includes(q) || b.id.includes(q));
  for (const b of list) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'icon-cell' + (editingIcon && editingIcon.type === 'brand' && editingIcon.id === b.id ? ' selected' : '');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = b.title;
    cell.append(brandTile(b), t);
    cell.addEventListener('click', () => chooseIcon({ type: 'brand', id: b.id }));
    grid.appendChild(cell);
  }
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No logo with that name. Try Upload to add your own image.';
    grid.appendChild(p);
  }
}
$('logo-search').addEventListener('input', renderLogoGrid);

function renderEmojiGrid() {
  const grid = $('emoji-grid');
  grid.replaceChildren();
  for (const em of EMOJIS) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'icon-cell';
    cell.textContent = em;
    cell.addEventListener('click', () => chooseIcon({ type: 'emoji', value: em }));
    grid.appendChild(cell);
  }
}
$('emoji-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const v = $('emoji-input').value.trim();
  if (v) chooseIcon({ type: 'emoji', value: [...v].slice(0, 8).join('') });
});
$('emoji-input').addEventListener('input', () => {
  // A pasted/typed emoji is chosen straight away (anything that isn't plain letters/numbers).
  const v = $('emoji-input').value.trim();
  if (v && /\p{Extended_Pictographic}/u.test(v)) chooseIcon({ type: 'emoji', value: [...v].slice(0, 8).join('') });
});

$('upload-btn').addEventListener('click', () => $('upload-file').click());
$('upload-file').addEventListener('change', async () => {
  const file = $('upload-file').files[0];
  $('upload-file').value = '';
  $('upload-error').textContent = '';
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) return ($('upload-error').textContent = 'That image is too large (over 15 MB).');
  try {
    // Crop to a centred square and shrink to 96×96 so it stays tiny inside the vault.
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 96, 96);
    const data = canvas.toDataURL('image/png');
    $('upload-preview').replaceChildren(avatarFor(editorEntry(), { type: 'image', data }));
    chooseIcon({ type: 'image', data });
  } catch {
    $('upload-error').textContent = "Couldn't read that image. Try a PNG or JPG.";
  }
});

$('letter-btn').addEventListener('click', () => chooseIcon({ type: 'letter' }));

$('e-icon-btn').addEventListener('click', () => {
  $('logo-search').value = $('e-title').value.trim();
  renderLogoGrid();
  if (!$('logo-grid').querySelector('.icon-cell')) {
    $('logo-search').value = '';
    renderLogoGrid();
  }
  renderEmojiGrid();
  $('emoji-input').value = '';
  $('upload-error').textContent = '';
  $('upload-preview').replaceChildren(avatarFor(editorEntry(), editingIcon && editingIcon.type === 'image' ? editingIcon : { type: 'letter' }));
  $('letter-preview').replaceChildren(avatarFor(editorEntry(), { type: 'letter' }));
  const tab = editingIcon ? { brand: 'logos', emoji: 'emoji', image: 'upload', letter: 'letter' }[editingIcon.type] : 'logos';
  show($('icon-modal'));
  iconTab(tab || 'logos');
});
$('icon-cancel').addEventListener('click', () => hide($('icon-modal')));
$('icon-modal').addEventListener('mousedown', (e) => {
  if (e.target === $('icon-modal')) hide($('icon-modal'));
});

$('add-btn').addEventListener('click', async () => {
  selectedId = null;
  renderList();
  openEditor(null);
  if (!$('e-password').value) await generateInto();
});
$('edit-btn').addEventListener('click', () => openEditor(current()));
$('cancel-btn').addEventListener('click', () => (selectedId ? selectEntry(selectedId) : showPane(null)));

$('e-reveal').addEventListener('click', () => {
  const input = $('e-password');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('e-reveal').textContent = input.type === 'password' ? 'Show' : 'Hide';
});

function updateStrength() {
  const { score, label } = strength($('e-password').value);
  const colors = ['transparent', 'var(--negative)', 'var(--warning)', 'var(--tan)', 'var(--positive)'];
  $('strength-bar').style.width = `${score * 25}%`;
  $('strength-bar').style.background = colors[score];
  $('strength-label').textContent = label;
}
$('e-password').addEventListener('input', updateStrength);

$('g-length').addEventListener('input', () => ($('g-length-val').textContent = $('g-length').value));

async function generateInto() {
  const pw = await window.api.generate({
    length: Number($('g-length').value),
    upper: $('g-upper').checked,
    lower: $('g-lower').checked,
    digits: $('g-digits').checked,
    symbols: $('g-symbols').checked,
  });
  $('e-password').value = pw;
  $('e-password').type = 'text';
  $('e-reveal').textContent = 'Hide';
  updateStrength();
}
$('g-btn').addEventListener('click', generateInto);

$('edit-pane').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('e-title').value.trim()) {
    $('e-title').focus();
    return toast('Please give this entry a name');
  }
  // Notes: plain text always (search, older versions of the app), plus the cleaned formatting if there is any.
  const notesHtml = RichNotes.sanitize($('e-notes').innerHTML);
  const saved = await window.api.save({
    id: editingId,
    title: $('e-title').value,
    username: $('e-username').value,
    password: $('e-password').value,
    url: $('e-url').value,
    notes: RichNotes.toText(notesHtml),
    notesHtml: RichNotes.hasFormatting(notesHtml) ? notesHtml : '',
    // existing files are sent by id only (their contents stay in the vault); new ones carry their contents
    attachments: editorFiles.map(({ id, name, type, size, data }) => (data ? { id, name, type, size, data } : { id, name, type, size })),
    folder: $('e-folder').value,
    icon: editingIcon, // null = automatic (matching logo or first letter)
  });
  if (saved && saved.locked) return; // master password changed on another computer; lock screen explains
  if (saved && saved.ok === false) return toast(saved.error || 'Couldn’t save this login');
  const added = await applyEditorReminders(saved);
  await loadData();
  toast(added ? `Saved, with ${added} new reminder${added === 1 ? '' : 's'}` : 'Saved');
  selectEntry(saved.id);
});

async function deleteLogin(e) {
  if (!e) return;
  // (The app's own pop-up, not the browser's confirm(): on Windows that one can leave text fields
  // unable to take typing until you switch windows.)
  const n = reminderCache.upcoming.filter((r) => r.loginId === e.id).length;
  const also = n ? ` Its ${n} reminder${n === 1 ? '' : 's'} will be cancelled too.` : '';
  const sure = await ask({ title: `Delete “${e.title}”?`, text: 'This cannot be undone.' + also, ok: 'Delete', danger: true, input: false });
  if (!sure) return;
  const res = await window.api.remove(e.id);
  if (res && res.locked) return;
  await loadData();
  const wasOpen = selectedId === e.id;
  if (wasOpen) selectedId = null;
  renderList();
  if (wasOpen) showPane(null);
  renderReminders();
  toast(`Deleted “${e.title}”`);
}
$('delete-btn').addEventListener('click', () => deleteLogin(current()));

function editLogin(e) {
  if (!e) return;
  selectedId = e.id;
  renderList();
  openEditor(e);
}

// ---------- reminders: your own message, after a timer or at a date & time ----------
let reminderFor = null; // the login a new reminder is about (or null)
let reminderForEditor = false; // made inside the login editor: kept until the login is saved
let reminderWhen = 'timer';
let reminderUnit = 'hours';
let reminderRepeat = '';
let reminderCache = { upcoming: [], recent: [] };
const REPEAT_TEXT = { day: 'Every day', week: 'Every week', month: 'Every month', monthEnd: 'Last day of every month', year: 'Every year' };
const REPEAT_SHORT = { day: 'every day', week: 'every week', month: 'every month', monthEnd: 'on the last day of every month', year: 'every year' };
const lastDayOf = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, d.getHours(), d.getMinutes());
const UNIT_MS = { minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };
const pad2 = (n) => String(n).padStart(2, '0');
const localInputValue = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const whenText = (d) => new Date(d).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function reminderAt() {
  let d;
  if (reminderWhen === 'timer') {
    const n = Number($('reminder-amount').value);
    if (!Number.isFinite(n) || n <= 0 || n > 999) return null;
    d = new Date(Date.now() + n * UNIT_MS[reminderUnit]);
  } else {
    const v = $('reminder-at').value;
    d = v ? new Date(v) : null; // "YYYY-MM-DDTHH:MM" is read as local time
    if (!d || Number.isNaN(d.getTime())) return null;
  }
  // "Month end": the last day of that month (28th–31st), at the same time.
  return reminderRepeat === 'monthEnd' ? lastDayOf(d) : d;
}
function updateReminderPreview() {
  const at = reminderAt();
  const text = $('reminder-when-text');
  text.parentElement.classList.toggle('warn', !!at && at <= Date.now());
  if (!at) text.textContent = reminderWhen === 'timer' ? 'Choose how long, from 1 to 999.' : 'Choose a date and time.';
  else if (at <= Date.now()) text.textContent = 'That time has already passed. Choose a time in the future.';
  else text.textContent = `You’ll get it on ${whenText(at)}${reminderRepeat ? `, then ${REPEAT_SHORT[reminderRepeat]}` : ''}.`;
  if (reminderWhen === 'date') renderCalendar();
}
function setReminderRepeat(v) {
  reminderRepeat = v;
  document.querySelectorAll('[data-repeat]').forEach((b) => {
    b.classList.toggle('active', b.dataset.repeat === v);
    b.setAttribute('aria-checked', String(b.dataset.repeat === v));
  });
  const at = reminderAt();
  if (at && reminderWhen === 'date') calMonth = new Date(at.getFullYear(), at.getMonth(), 1); // show the day it will be
  updateReminderPreview();
}

// ---------- the reminder calendar (the page's own, styled like the rest of the app) ----------
let calMonth = new Date(); // first day of the month shown
let calPick = new Date(); // chosen day and time
function setCalPick(d, showMonth = true) {
  calPick = new Date(d);
  if (showMonth) calMonth = new Date(calPick.getFullYear(), calPick.getMonth(), 1);
  $('reminder-at').value = localInputValue(calPick);
  const h = calPick.getHours();
  $('time-hour').value = String(h % 12 || 12);
  $('time-minute').value = pad2(calPick.getMinutes());
  document.querySelectorAll('[data-ampm]').forEach((b) => {
    const on = b.dataset.ampm === (h < 12 ? 'AM' : 'PM');
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  if (document.activeElement !== $('cal-type')) {
    $('cal-type').value = calPick.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    $('cal-type-error').textContent = '';
  }
  updateReminderPreview();
}
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfToday = () => {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
};
let calView = 'days'; // or 'months' (pick a month and year)

// Always six rows of days (the end of last month and start of next month greyed in), so the pop-up
// never changes size from one month to the next.
function renderCalendar() {
  const today = startOfToday();
  const months = calView === 'months';
  $('cal-day-view').classList.toggle('hidden', months);
  $('cal-months').classList.toggle('hidden', !months);
  $('cal-prev').setAttribute('aria-label', months ? 'Previous year' : 'Previous month');
  $('cal-next').setAttribute('aria-label', months ? 'Next year' : 'Next month');
  if (months) return renderMonthPicker(today);
  $('cal-title').textContent = calMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const shown = reminderAt() || calPick; // with "Month end", the day it will really be
  const start = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1 - calMonth.getDay()); // the Sunday on or before the 1st
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-day';
    b.textContent = date.getDate();
    b.setAttribute('aria-label', date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    const inMonth = date.getMonth() === calMonth.getMonth();
    if (!inMonth) b.classList.add('other-month');
    if (sameDay(date, today)) b.classList.add('today');
    if (sameDay(date, shown)) {
      b.classList.add('selected');
      b.setAttribute('aria-selected', 'true');
    }
    if (inMonth && date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()) b.classList.add('month-end');
    if (date < today) b.disabled = true;
    b.addEventListener('click', () => {
      const d = new Date(date);
      d.setHours(calPick.getHours(), calPick.getMinutes(), 0, 0);
      setCalPick(d, !inMonth); // a greyed day from next/last month also turns the page
    });
    cells.push(b);
  }
  $('cal-days').replaceChildren(...cells);
  // can't go back before this month
  $('cal-prev').disabled = calMonth.getFullYear() === today.getFullYear() && calMonth.getMonth() <= today.getMonth();
}

// Month-and-year view: the arrows change the year; click a month to see its days.
function renderMonthPicker(today) {
  const year = calMonth.getFullYear();
  $('cal-title').textContent = String(year);
  const cells = [];
  for (let m = 0; m < 12; m++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-month';
    b.textContent = new Date(year, m, 1).toLocaleDateString([], { month: 'short' });
    if (year === calPick.getFullYear() && m === calPick.getMonth()) b.classList.add('selected');
    if (year === today.getFullYear() && m === today.getMonth()) b.classList.add('today');
    if (year < today.getFullYear() || (year === today.getFullYear() && m < today.getMonth())) b.disabled = true;
    b.addEventListener('click', () => {
      calMonth = new Date(year, m, 1);
      calView = 'days';
      renderCalendar();
    });
    cells.push(b);
  }
  $('cal-months').replaceChildren(...cells);
  $('cal-prev').disabled = year <= today.getFullYear();
}
(() => {
  const names = [];
  for (let i = 0; i < 7; i++) names.push(new Date(2026, 1, 1 + i).toLocaleDateString([], { weekday: 'short' }).slice(0, 2)); // 1 Feb 2026 was a Sunday
  $('cal-weekdays').replaceChildren(...names.map((n) => Object.assign(document.createElement('span'), { textContent: n })));
})();
const stepCalendar = (dir) => {
  const step = calView === 'months' ? 12 : 1;
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + dir * step, 1);
  if (calView === 'months' && calMonth < new Date(startOfToday().getFullYear(), 0, 1)) calMonth = new Date(startOfToday().getFullYear(), 0, 1);
  renderCalendar();
};
$('cal-prev').addEventListener('click', () => stepCalendar(-1));
$('cal-next').addEventListener('click', () => stepCalendar(1));
$('cal-title').addEventListener('click', () => {
  calView = calView === 'days' ? 'months' : 'days';
  renderCalendar();
});

// ---------- typing a date ----------
// Understands e.g. "3/15/2027", "15/3/2027" (in the order this computer uses), "2027-03-15", "March 15 2027",
// "15 Mar", "Mar 15" (the next one coming up), "today", "tomorrow".
const DATE_ORDER = (() => {
  try {
    return new Intl.DateTimeFormat([], { day: 'numeric', month: 'numeric', year: 'numeric' })
      .formatToParts(new Date(2027, 2, 15))
      .map((p) => p.type)
      .filter((t) => ['day', 'month', 'year'].includes(t));
  } catch {
    return ['month', 'day', 'year'];
  }
})();
const MONTH_NAMES = Array.from({ length: 12 }, (_, m) => [
  new Date(2027, m, 1).toLocaleDateString([], { month: 'long' }).toLowerCase(),
  new Date(2027, m, 1).toLocaleDateString('en', { month: 'long' }).toLowerCase(),
]);
function parseTypedDate(text) {
  const s = String(text || '').trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ');
  if (!s) return null;
  const today = startOfToday();
  if (s === 'today') return today;
  if (s === 'tomorrow') return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  let y, m, d;
  let iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (iso) [y, m, d] = [+iso[1], +iso[2] - 1, +iso[3]];
  else if (/^\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?$/.test(s)) {
    const nums = s.split(/[-/.]/).map(Number);
    const order = nums.length === 3 ? DATE_ORDER : DATE_ORDER.filter((t) => t !== 'year');
    order.forEach((t, i) => {
      if (t === 'day') d = nums[i];
      else if (t === 'month') m = nums[i] - 1;
      else y = nums[i];
    });
  } else {
    const words = s.split(/\s+/);
    for (const w of words) {
      if (/^\d{4}$/.test(w)) y = +w;
      else if (/^\d{1,2}$/.test(w)) d = +w;
      else if (w.length >= 3) {
        const i = MONTH_NAMES.findIndex((names) => names.some((n) => n.startsWith(w)));
        if (i >= 0) m = i;
      }
    }
  }
  if (m === undefined || d === undefined) return null;
  if (y !== undefined && y < 100) y += 2000;
  let date = new Date(y === undefined ? today.getFullYear() : y, m, d);
  if (date.getMonth() !== m || date.getDate() !== d) return null; // e.g. 30 February
  if (y === undefined && date < today) date = new Date(today.getFullYear() + 1, m, d); // "Mar 15" = the next one
  return date;
}
function applyTypedDate() {
  const typed = $('cal-type').value;
  const date = parseTypedDate(typed);
  if (!date) {
    $('cal-type-error').textContent = typed.trim() ? 'That doesn’t look like a date. Try e.g. ' + exampleDate() : '';
    return false;
  }
  if (date < startOfToday()) {
    $('cal-type-error').textContent = 'That date has already passed.';
    return false;
  }
  date.setHours(calPick.getHours(), calPick.getMinutes(), 0, 0);
  calView = 'days';
  $('cal-type').blur();
  setCalPick(date);
  return true;
}
const exampleDate = () => new Date(2027, 2, 15).toLocaleDateString([], { day: 'numeric', month: 'numeric', year: 'numeric' });
$('cal-type').placeholder = `Type a date, e.g. ${exampleDate()} or “March 15”`;
$('cal-type').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault(); // don't set the reminder yet
    applyTypedDate();
  }
});
$('cal-type').addEventListener('input', () => ($('cal-type-error').textContent = ''));
$('cal-type').addEventListener('change', applyTypedDate);
$('cal-type').addEventListener('focus', () => $('cal-type').select());
function readTime() {
  let h = Math.min(12, Math.max(1, parseInt($('time-hour').value, 10) || 12));
  const m = Math.min(59, Math.max(0, parseInt($('time-minute').value, 10) || 0));
  const pm = document.querySelector('[data-ampm].active')?.dataset.ampm === 'PM';
  h = (h % 12) + (pm ? 12 : 0);
  const d = new Date(calPick);
  d.setHours(h, m, 0, 0);
  return d;
}
for (const id of ['time-hour', 'time-minute']) {
  $(id).addEventListener('input', () => {
    calPick = readTime();
    $('reminder-at').value = localInputValue(calPick);
    updateReminderPreview();
  });
  $(id).addEventListener('change', () => setCalPick(readTime(), false)); // tidy, e.g. "7" → "07"
}
document.querySelectorAll('[data-ampm]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-ampm]').forEach((x) => x.classList.toggle('active', x === b));
    setCalPick(readTime(), false);
  })
);
document.querySelectorAll('[data-quick]').forEach((b) =>
  b.addEventListener('click', () => {
    const d = new Date();
    if (b.dataset.quick === 'tomorrow') {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
    } else if (b.dataset.quick === 'monday') {
      d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
      d.setHours(9, 0, 0, 0);
    } else {
      // the last day of this month at the chosen time (or next month's, if that has passed)
      d.setHours(calPick.getHours(), calPick.getMinutes(), 0, 0);
      let end = lastDayOf(d);
      if (end <= Date.now()) end = lastDayOf(new Date(d.getFullYear(), d.getMonth() + 1, 1, d.getHours(), d.getMinutes()));
      d.setTime(end.getTime());
    }
    setCalPick(d);
  })
);
// Timer: − / + beside the number.
document.querySelectorAll('#reminder-timer [data-step]').forEach((b) =>
  b.addEventListener('click', () => {
    const n = Math.min(999, Math.max(1, (parseInt($('reminder-amount').value, 10) || 0) + Number(b.dataset.step)));
    $('reminder-amount').value = String(n);
    updateReminderPreview();
  })
);
document.querySelectorAll('[data-repeat]').forEach((b) => b.addEventListener('click', () => setReminderRepeat(b.dataset.repeat)));
function setReminderWhen(w) {
  reminderWhen = w;
  document.querySelectorAll('[data-when]').forEach((b) => {
    b.classList.toggle('active', b.dataset.when === w);
    b.setAttribute('aria-checked', String(b.dataset.when === w));
  });
  $('reminder-timer').classList.toggle('hidden', w !== 'timer');
  $('reminder-date').classList.toggle('hidden', w !== 'date');
  $('reminder-at').min = localInputValue(new Date());
  updateReminderPreview();
}
function setReminderUnit(u) {
  reminderUnit = u;
  document.querySelectorAll('[data-unit]').forEach((b) => {
    b.classList.toggle('active', b.dataset.unit === u);
    b.setAttribute('aria-checked', String(b.dataset.unit === u));
  });
  updateReminderPreview();
}
document.querySelectorAll('[data-when]').forEach((b) => b.addEventListener('click', () => setReminderWhen(b.dataset.when)));
document.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => setReminderUnit(b.dataset.unit)));
$('reminder-amount').addEventListener('input', updateReminderPreview);
$('reminder-at').addEventListener('input', updateReminderPreview);

function openReminder(entry, forEditor = false) {
  closeMenu();
  reminderFor = entry || null;
  reminderForEditor = forEditor;
  $('reminder-title').textContent = entry && entry.title ? `Remind me about “${entry.title}”` : forEditor ? 'Remind me about this login' : 'New reminder';
  $('reminder-sub').textContent = forEditor
    ? 'Saved when you save this login. You’ll get a notification with this message, even if the window is closed.'
    : 'You’ll get a notification with this message, even if the window is closed.';
  setReminderRepeat('');
  $('reminder-text').value = '';
  $('reminder-error').textContent = '';
  $('reminder-amount').value = '1';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  calView = 'days';
  setCalPick(tomorrow);
  setReminderUnit('hours');
  setReminderWhen('timer');
  show($('reminder-modal'));
  $('reminder-text').focus();
}
function closeReminder() {
  hide($('reminder-modal'));
  reminderFor = null;
  reminderForEditor = false;
}
$('reminder-cancel').addEventListener('click', closeReminder);
$('reminder-modal').addEventListener('mousedown', (e) => {
  if (e.target === $('reminder-modal')) closeReminder();
});
$('reminder-modal').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeReminder();
  }
});
$('reminder-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('reminder-form').requestSubmit();
  }
});
$('reminder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('reminder-text').value.trim();
  const at = reminderAt();
  const err = $('reminder-error');
  if (!text) return (err.textContent = 'Type what you want to be reminded about.');
  if (!at) return (err.textContent = reminderWhen === 'timer' ? 'Choose how long, from 1 to 999.' : 'Choose a date and time.');
  if (at <= Date.now()) return (err.textContent = 'Choose a time in the future.');
  if (reminderForEditor) {
    // Inside the login editor: keep it until the login is saved (a new login has no id yet).
    editorReminders.pending.push({ id: 'new-' + Math.random().toString(36).slice(2), text, at: at.toISOString(), repeat: reminderRepeat || null });
    closeReminder();
    renderEditorReminders();
    return;
  }
  const res = await window.api.addReminder({
    text,
    at: at.toISOString(),
    repeat: reminderRepeat || null,
    loginId: reminderFor ? reminderFor.id : null,
    loginTitle: reminderFor ? reminderFor.title : null,
  });
  if (res.locked) return closeReminder();
  if (!res.ok) return (err.textContent = res.error);
  closeReminder();
  await renderReminders();
  toast(`Reminder set for ${whenText(res.reminder.at)}${res.reminder.repeat ? `, ${REPEAT_SHORT[res.reminder.repeat]}` : ''}`);
});

// One reminder in a list. opts: { showLogin, note, button: 'Cancel' | 'Remove', onButton, open }
function reminderItem(r, opts = {}) {
  const li = document.createElement('li');
  li.insertAdjacentHTML('afterbegin', ICON.bell);
  const body = Object.assign(document.createElement('div'), { className: 'reminder-body' });
  const when = [opts.note || whenText(r.at)];
  if (r.repeat) when.push(REPEAT_TEXT[r.repeat]);
  if (opts.showLogin && r.loginTitle) when.push(r.loginTitle);
  body.append(
    Object.assign(document.createElement('div'), { className: 'reminder-text', textContent: r.text }),
    Object.assign(document.createElement('div'), { className: 'reminder-when', textContent: when.join(' · ') })
  );
  // Settings: click a reminder about a login to open that login.
  if (opts.open && r.loginId && entries.some((e) => e.id === r.loginId)) {
    body.classList.add('clickable');
    body.title = `Open “${r.loginTitle}”`;
    body.addEventListener('click', () => selectEntry(r.loginId));
  }
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'reminder-cancel', textContent: opts.button || 'Cancel' });
  btn.addEventListener('click', () => opts.onButton(r));
  li.append(body, btn);
  return li;
}

async function cancelReminder(r) {
  const res = await window.api.removeReminder(r.id);
  if (res.locked) return;
  await renderReminders();
  toast('Reminder cancelled');
}

// Every reminder in Settings (upcoming, then ones already sent), and the open login's own on its page.
async function renderReminders() {
  const data = await window.api.reminders();
  reminderCache = { upcoming: data.upcoming || [], recent: data.recent || [] };
  const { upcoming, recent } = reminderCache;
  $('s-reminder-list').replaceChildren(...upcoming.map((r) => reminderItem(r, { showLogin: true, open: true, onButton: cancelReminder })));
  $('s-reminder-list').classList.toggle('hidden', !upcoming.length);
  $('s-reminder-empty').classList.toggle('hidden', !!upcoming.length);
  $('s-recent-list').replaceChildren(
    ...recent.map((r) =>
      reminderItem(r, {
        showLogin: true,
        open: true,
        note: `Sent ${whenText(r.shownAt || r.at)}`,
        button: 'Remove',
        onButton: async (x) => {
          await window.api.removeReminder(x.id);
          renderReminders();
        },
      })
    )
  );
  $('s-recent-wrap').classList.toggle('hidden', !recent.length);
  const e = current();
  const mine = e ? upcoming.filter((r) => r.loginId === e.id) : [];
  $('v-reminder-list').replaceChildren(...mine.map((r) => reminderItem(r, { onButton: cancelReminder })));
  $('v-reminders').classList.toggle('hidden', !mine.length);
  if (!$('edit-pane').classList.contains('hidden')) renderEditorReminders();
}
$('s-recent-clear').addEventListener('click', async () => {
  await window.api.clearReminderHistory();
  renderReminders();
});

// ---------- reminders inside the login editor ----------
// Added or cancelled here, they take effect when the login is saved (and are dropped if you cancel).
let editorReminders = { pending: [], removed: new Set() };
function resetEditorReminders() {
  editorReminders = { pending: [], removed: new Set() };
  renderEditorReminders();
  renderReminders();
}
function renderEditorReminders() {
  const existing = editingId ? reminderCache.upcoming.filter((r) => r.loginId === editingId && !editorReminders.removed.has(r.id)) : [];
  const items = [
    ...existing.map((r) => reminderItem(r, { onButton: (x) => (editorReminders.removed.add(x.id), renderEditorReminders()) })),
    ...editorReminders.pending.map((r) =>
      reminderItem(r, {
        note: `${whenText(r.at)} · new`,
        button: 'Remove',
        onButton: (x) => {
          editorReminders.pending = editorReminders.pending.filter((p) => p.id !== x.id);
          renderEditorReminders();
        },
      })
    ),
  ];
  $('e-reminder-list').replaceChildren(...items);
  $('e-reminder-list').classList.toggle('hidden', !items.length);
}
$('e-reminder-add').addEventListener('click', () => openReminder({ id: editingId, title: $('e-title').value.trim() }, true));

// After the login is saved: cancel the ones removed in the editor and add the new ones.
async function applyEditorReminders(saved) {
  let failed = 0;
  for (const id of editorReminders.removed) await window.api.removeReminder(id);
  for (const p of editorReminders.pending) {
    const res = await window.api.addReminder({ text: p.text, at: p.at, repeat: p.repeat, loginId: saved.id, loginTitle: saved.title });
    if (!res.ok) failed++;
  }
  const added = editorReminders.pending.length - failed;
  editorReminders = { pending: [], removed: new Set() };
  await renderReminders();
  if (failed) toast(`${failed} reminder${failed === 1 ? '' : 's'} couldn’t be set (the time had passed)`);
  return added;
}
$('remind-btn').addEventListener('click', () => openReminder(current()));
$('reminder-new').addEventListener('click', () => openReminder(null));
window.api.onRemindersChanged(() => {
  if (!$('app-screen').classList.contains('hidden')) renderReminders();
});
// Clicked a reminder's notification: show the login it's about (once unlocked).
window.api.onReminderOpen((id) => {
  if ($('app-screen').classList.contains('hidden') || !entries.some((e) => e.id === id)) return;
  selectEntry(id);
});

// ---------- settings ----------
$('settings-btn').addEventListener('click', () => {
  for (const id of ['s-current', 's-new', 's-confirm']) $(id).value = '';
  $('settings-msg').textContent = '';
  renderSync();
  renderBio();
  renderBackground();
  renderReminders();
  showPane('settings-pane');
  $('s-current').focus();
});
$('settings-cancel').addEventListener('click', () => (selectedId ? selectEntry(selectedId) : showPane(null)));

$('settings-pane').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('settings-msg');
  msg.style.color = 'var(--negative)';
  if ($('s-new').value !== $('s-confirm').value) return (msg.textContent = 'New passwords do not match.');
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Updating…';
  const res = await window.api.changeMaster($('s-current').value, $('s-new').value);
  for (const id of ['s-current', 's-new', 's-confirm']) $(id).value = '';
  if (!res.ok) {
    msg.style.color = 'var(--negative)';
    msg.textContent = res.error;
    return;
  }
  msg.style.color = 'var(--positive)';
  msg.textContent = 'Master password changed.';
});

// ---------- locking ----------
$('lock-btn').addEventListener('click', () => window.api.lock());

window.api.onLocked((reason) => {
  closeReminder();
  const messages = {
    idle: 'Locked after 5 minutes of inactivity.',
    system: 'Locked because your computer was locked or went to sleep.',
    'password-changed': 'Your master password was changed on another computer. Unlock with the new one.',
  };
  showLockScreen(messages[reason] || '');
});

// ---------- updates ----------
let update = { state: 'idle' };
let dismissed = null; // "state:version" the user clicked Later on

function renderUpdate() {
  const s = update;
  if (s.currentVersion) $('current-version').textContent = s.currentVersion;
  const hasUpdate = ['available', 'downloading', 'downloaded'].includes(s.state);
  $('update-dot').classList.toggle('hidden', !hasUpdate);

  // Settings card
  const text = $('update-text');
  const action = $('update-action');
  text.className = 'update-text';
  hide(action);
  hide($('settings-progress'));
  $('check-updates-btn').disabled = s.state === 'checking' || s.state === 'downloading';
  switch (s.state) {
    case 'checking':
      text.textContent = 'Checking for updates…';
      break;
    case 'none':
      text.textContent = 'You have the latest version.';
      text.classList.add('ok');
      break;
    case 'available':
      text.textContent = `Version ${s.version} is available.`;
      action.textContent = s.isMac ? 'Download' : 'Update now';
      show(action);
      break;
    case 'downloading':
      text.textContent = `Downloading update… ${s.percent || 0}%`;
      show($('settings-progress'));
      $('settings-progress').firstElementChild.style.width = `${s.percent || 0}%`;
      break;
    case 'downloaded':
      text.textContent = `Version ${s.version} is ready to install.`;
      action.textContent = 'Restart & update';
      show(action);
      break;
    case 'error':
      text.textContent = s.error;
      text.classList.add('err');
      break;
    default:
      text.textContent = 'Password Vault checks for updates automatically.';
  }

  // Banner
  const key = `${s.state}:${s.version}`;
  const banner = $('update-banner');
  const bannerStates = { available: 1, downloading: 1, downloaded: 1 };
  const downloadFailed = s.state === 'error' && update.wasDownloading;
  if ((!bannerStates[s.state] && !downloadFailed) || dismissed === key) return hide(banner);
  hide($('banner-progress'));
  show($('banner-action'));
  $('banner-later').textContent = 'Later';
  if (s.state === 'available') {
    $('banner-title').textContent = 'Update available';
    $('banner-text').textContent = s.isMac
      ? `Version ${s.version} is out (you have ${s.currentVersion}). Download it, then drag it into Applications.`
      : `Version ${s.version} is ready (you have ${s.currentVersion}).`;
    $('banner-action').textContent = s.isMac ? 'Download' : 'Update now';
  } else if (s.state === 'downloading') {
    $('banner-title').textContent = 'Downloading update…';
    $('banner-text').textContent = `${s.percent || 0}% — you can keep using the app.`;
    show($('banner-progress'));
    $('banner-progress').firstElementChild.style.width = `${s.percent || 0}%`;
    hide($('banner-action'));
    $('banner-later').textContent = 'Hide';
  } else if (s.state === 'downloaded') {
    $('banner-title').textContent = 'Ready to install';
    $('banner-text').textContent = `Restart to finish updating to version ${s.version}. Your passwords stay safe.`;
    $('banner-action').textContent = 'Restart & update';
  } else {
    $('banner-title').textContent = 'Update failed';
    $('banner-text').textContent = s.error;
    $('banner-action').textContent = 'Try again';
  }
  show(banner);
}

function setUpdate(s) {
  const wasDownloading = update.state === 'downloading' || (update.state === 'error' && update.wasDownloading);
  update = { ...s, wasDownloading: s.state === 'error' ? wasDownloading : false };
  renderUpdate();
}

async function runUpdateAction() {
  if (update.state === 'downloaded') return window.api.installUpdate();
  if (update.state === 'available' || update.state === 'error') {
    dismissed = null;
    return window.api.downloadUpdate();
  }
}

$('banner-action').addEventListener('click', runUpdateAction);
$('update-action').addEventListener('click', runUpdateAction);
$('banner-later').addEventListener('click', () => {
  dismissed = `${update.state}:${update.version}`;
  hide($('update-banner'));
});
$('check-updates-btn').addEventListener('click', () => {
  dismissed = null;
  window.api.checkForUpdates();
});

window.api.onUpdateStatus(setUpdate);
window.api.updateStatus().then(setUpdate);

// ---------- title bar menus (Vault / Edit / Window) ----------
if (window.api.platform === 'darwin') {
  document.body.classList.add('mac');
  // Mac shortcuts use ⌘ (and redo is ⇧⌘Z).
  document.querySelectorAll('.menu-item kbd').forEach((k) => {
    k.textContent = k.textContent === 'Ctrl+Y' ? '⇧⌘Z' : k.textContent.replace('Ctrl+', '⌘');
  });
}
// In full screen the Mac traffic lights disappear, so the logo moves to the edge.
window.api.onFullScreen((on) => document.body.classList.toggle('fullscreen', on));
let openMenu = null;

function closeMenus() {
  document.querySelectorAll('.menu-pop').forEach((p) => p.classList.add('hidden'));
  document.querySelectorAll('.menu-top').forEach((b) => b.classList.remove('open'));
  openMenu = null;
}

async function showMenu(name) {
  closeMenus();
  openMenu = name;
  const unlocked = $('lock-screen').classList.contains('hidden');
  document.querySelectorAll('[data-needs="unlocked"]').forEach((b) => (b.disabled = !unlocked));
  if (name === 'window') $('menu-maximize').textContent = (await window.api.isMaximized()) ? 'Restore size' : 'Maximise';
  document.querySelector(`[data-menu="${name}"]`).classList.add('open');
  document.querySelector(`[data-pop="${name}"]`).classList.remove('hidden');
}

// Keep the text cursor where it was, so Edit → Paste goes into the field you were typing in.
$('menubar').addEventListener('mousedown', (e) => e.preventDefault());

document.querySelectorAll('.menu-top').forEach((btn) => {
  btn.addEventListener('click', () => (openMenu === btn.dataset.menu ? closeMenus() : showMenu(btn.dataset.menu)));
  // Once one menu is open, hovering the others switches between them (like a normal menu bar).
  btn.addEventListener('mouseenter', () => openMenu && openMenu !== btn.dataset.menu && showMenu(btn.dataset.menu));
});

document.querySelectorAll('.menu-item').forEach((item) => {
  item.addEventListener('click', () => {
    closeMenus();
    window.api.menuAction(item.dataset.action);
  });
});

document.addEventListener('mousedown', (e) => {
  if (openMenu && !e.target.closest('#menubar')) closeMenus();
});
window.addEventListener('blur', closeMenus);

// Escape closes editor/settings.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenu) return closeMenus();
  if (e.key === 'Escape' && !$('ctx-menu').classList.contains('hidden')) return closeMenu();
  if (e.key === 'Escape' && !$('table-picker').classList.contains('hidden')) return closeTablePicker();
  if (e.key === 'Escape' && !$('folder-menu').classList.contains('hidden')) return closeFolderPicker();
  if (e.key === 'Escape' && !$('ask-modal').classList.contains('hidden')) return askCancel && askCancel();
  if (e.key === 'Escape' && !$('icon-modal').classList.contains('hidden')) return hide($('icon-modal'));
  if (e.key === 'Escape' && syncMode) return closeSyncModal();
  if (e.key === 'Escape' && !$('bio-modal').classList.contains('hidden')) return closeBioModal();
  if (e.key === 'Escape' && !$('app-screen').classList.contains('hidden')) {
    if (!$('edit-pane').classList.contains('hidden') || !$('settings-pane').classList.contains('hidden')) {
      selectedId ? selectEntry(selectedId) : showPane(null);
    }
  }
});

showLockScreen();
