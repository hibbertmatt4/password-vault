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
async function showLockScreen(message) {
  const { exists } = await window.api.status();
  creating = !exists;
  hide($('app-screen'));
  show($('lock-screen'));
  $('master').value = '';
  $('master-confirm').value = '';
  $('lock-error').textContent = message || '';
  $('lock-subtitle').textContent = creating
    ? 'Create a master password to set up your vault.'
    : 'Enter your master password to unlock.';
  $('lock-submit').textContent = creating ? 'Create vault' : 'Unlock';
  $('master-confirm-wrap').classList.toggle('hidden', !creating);
  document.querySelectorAll('.eye-btn').forEach((btn) => setEye(btn, false));
  $('create-warning').classList.toggle('hidden', !creating);
  entries = [];
  selectedId = null;
  $('master').focus();
}

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
    const res = creating ? await window.api.create(pw) : await window.api.unlock(pw);
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
  entries = await window.api.list();
  toast('Saved');
  selectEntry(saved.id);
});

$('delete-btn').addEventListener('click', async () => {
  const e = current();
  if (!e) return;
  if (!confirm(`Delete "${e.title}"? This cannot be undone.`)) return;
  await window.api.remove(e.id);
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
  const messages = { idle: 'Locked after 5 minutes of inactivity.', system: 'Locked because your computer was locked or went to sleep.' };
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

// Escape closes editor/settings.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('app-screen').classList.contains('hidden')) {
    if (!$('edit-pane').classList.contains('hidden') || !$('settings-pane').classList.contains('hidden')) {
      selectedId ? selectEntry(selectedId) : showPane(null);
    }
  }
});

showLockScreen();
