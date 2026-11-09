'use strict';
const $ = (id) => document.getElementById(id);

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

async function showLockScreen(message) {
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
}

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
  if (!confirm('Start a brand-new, empty vault on this computer? Your synced vault stays where it is, and you can connect to it again later.')) return;
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
      toast(`Found your vault in ${res.where.name}. Unlock it to continue.`);
    } else {
      if (!$('sync-pw').value) return ($('sync-error').textContent = 'Enter your master password to confirm.');
      const res = await window.api.syncEnable(syncChoice, $('sync-pw').value);
      $('sync-pw').value = '';
      if (!res.ok) {
        if (!res.locked) $('sync-error').textContent = res.error;
        return;
      }
      closeSyncModal();
      await afterRepaint(); // let the pop-up and its blur disappear before the card changes size
      await refreshEntries();
      await renderSync(res.status);
      toast(`Syncing via ${res.status.name}`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
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
}

$('sync-setup').addEventListener('click', () => openSyncModal('enable'));
$('sync-open-folder').addEventListener('click', () => window.api.syncShowFolder());
$('sync-stop').addEventListener('click', async () => {
  if (!confirm('Stop syncing? A copy of your vault will be kept on this computer only. Your other computers keep using the copy in the cloud drive.')) return;
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
async function refreshEntries() {
  entries = await window.api.list();
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
  entries = await window.api.list();
  $('search').value = '';
  renderList();
  showPane(null);
}

function sortedFiltered() {
  const q = $('search').value.trim().toLowerCase();
  return entries
    .filter((e) => !q || e.title.toLowerCase().includes(q) || e.username.toLowerCase().includes(q) || e.url.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

function renderList() {
  const list = $('entry-list');
  list.replaceChildren();
  const items = sortedFiltered();
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = entries.length ? 'No matches.' : 'No passwords saved yet.';
    list.appendChild(li);
    return;
  }
  for (const entry of items) {
    const li = document.createElement('li');
    if (entry.id === selectedId) li.classList.add('active');
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = (entry.title[0] || '?').toUpperCase();
    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = entry.title;
    const u = document.createElement('div');
    u.className = 'u';
    u.textContent = entry.username || entry.url || '';
    meta.append(t, u);
    li.append(av, meta);
    li.addEventListener('click', () => selectEntry(entry.id));
    list.appendChild(li);
  }
}

function showPane(name) {
  for (const id of ['empty-state', 'view-pane', 'edit-pane', 'settings-pane']) hide($(id));
  show($(name || 'empty-state'));
}

function current() {
  return entries.find((e) => e.id === selectedId);
}

function selectEntry(id) {
  selectedId = id;
  renderList();
  const e = current();
  if (!e) return showPane(null);
  $('v-title').textContent = e.title;
  $('v-username').textContent = e.username || '—';
  $('v-password').textContent = '••••••••••••';
  $('v-password').dataset.revealed = '';
  $('reveal-btn').textContent = 'Show';
  $('v-url').textContent = e.url;
  $('v-url-field').classList.toggle('hidden', !e.url);
  $('v-notes').textContent = e.notes;
  $('v-notes-field').classList.toggle('hidden', !e.notes);
  $('v-meta').textContent = `Last updated ${new Date(e.updatedAt).toLocaleString()}`;
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
  $('e-notes').value = entry ? entry.notes : '';
  updateStrength();
  showPane('edit-pane');
  $('e-title').focus();
}

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
  const saved = await window.api.save({
    id: editingId,
    title: $('e-title').value,
    username: $('e-username').value,
    password: $('e-password').value,
    url: $('e-url').value,
    notes: $('e-notes').value,
  });
  if (saved && saved.locked) return; // master password changed on another computer; lock screen explains
  entries = await window.api.list();
  toast('Saved');
  selectEntry(saved.id);
});

$('delete-btn').addEventListener('click', async () => {
  const e = current();
  if (!e) return;
  if (!confirm(`Delete "${e.title}"? This cannot be undone.`)) return;
  const res = await window.api.remove(e.id);
  if (res && res.locked) return;
  entries = await window.api.list();
  selectedId = null;
  renderList();
  showPane(null);
  toast('Deleted');
});

// ---------- settings ----------
$('settings-btn').addEventListener('click', () => {
  for (const id of ['s-current', 's-new', 's-confirm']) $(id).value = '';
  $('settings-msg').textContent = '';
  renderSync();
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
if (window.api.platform === 'darwin') document.body.classList.add('mac');
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
  if (e.key === 'Escape' && syncMode) return closeSyncModal();
  if (e.key === 'Escape' && !$('app-screen').classList.contains('hidden')) {
    if (!$('edit-pane').classList.contains('hidden') || !$('settings-pane').classList.contains('hidden')) {
      selectedId ? selectEntry(selectedId) : showPane(null);
    }
  }
});

showLockScreen();
