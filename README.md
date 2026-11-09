# Password Vault

An offline, encrypted password manager for Windows and Mac.

## Features
- One master password unlocks everything. It is never stored anywhere.
- Your vault is encrypted with **AES-256-GCM**. The key comes from your master password via **scrypt**. There's no account and no Password Vault server. The vault stays on your computer, or in your own cloud drive if you turn on sync.
- Add, edit, delete and search your logins (name, username, password, website, notes).
- Built-in strong password generator and a strength meter.
- Copied passwords are **wiped from the clipboard after 30 seconds**.
- **Auto-locks** after 5 minutes of inactivity, or when your computer locks or sleeps. You can also lock it yourself with Ctrl+L / Cmd+L.
- Repeated wrong master passwords get progressively slower.

> ⚠️ If you forget your master password, your data **cannot be recovered**.

## Where your data lives
- **Not syncing:** Windows `%APPDATA%\Password Vault\vault.json`, Mac `~/Library/Application Support/Password Vault/vault.json`
- **Syncing:** a `Password Vault` folder in the cloud drive you chose, for example `OneDrive\Password Vault\vault.json`

Backups stay on each computer in the `backups` folder next to the "not syncing" location above. Every file is encrypted.

## Syncing between computers
Your passwords can be shared between your Mac and Windows computers through a cloud drive you already use: **iCloud Drive, OneDrive, Google Drive or Dropbox**. Password Vault finds these automatically. You can also pick any folder your cloud app keeps in sync.

**First computer**
- **New vault:** under **Where to keep your vault**, pick your cloud drive.
- **Existing vault:** go to **Settings → Sync between your computers → Set up sync**, pick the drive, and confirm with your master password.

**Other computers**
1. Install the cloud drive's app and sign in.
2. Open Password Vault and click **Already use Password Vault on another computer? Connect to it**.
3. Pick the same drive and unlock with the same master password.

**How it behaves**
- **Speed:** changes show up on your other computers within a few seconds of the cloud drive syncing them, even while the app is open.
- **Simultaneous edits:** if you edit on two computers before they sync, both sets of changes are kept. For the same login, the newest edit wins. Deleted logins stay deleted.
- **Master password changes:** your other computers lock and ask for the new password.
- **Privacy:** the cloud company only ever sees the encrypted file.
- **Stopping:** **Settings → Stop syncing** keeps a copy on that computer only.

## Installing on Windows
Run `dist\Password-Vault-Setup-<version>.exe`. The app isn't code-signed, so Windows SmartScreen may warn you. Click **More info → Run anyway**.

## Building the Mac version
Mac apps have to be built on a Mac. If you don't have one, GitHub can build it for free:

GitHub builds the Mac version automatically each time a new version is released (see **Releasing an update** below). Download the `.dmg` file from the repository's **Releases** page. The Windows installer is on the same page.

The Mac app isn't signed by Apple, so macOS blocks it the first time. Go to **System Settings → Privacy & Security**, scroll to **Security**, and click **Open Anyway**. If that button isn't there, run `xattr -dr com.apple.quarantine "/Applications/Password Vault.app"` in Terminal.

If you do have a Mac: install Node.js, then run `npm install` and `npm run dist:mac` in this folder.

## Updates
The app checks for new versions when it starts, and then every 4 hours. When one is found:
- you get a system notification and a banner in the app, and a dot appears on **Settings**;
- **Windows:** click **Update now**, then **Restart & update** (or it installs next time you quit);
- **Mac:** click **Download** to get the new version, then drag it into Applications. Unsigned Mac apps can't replace themselves.

You can also go to **Settings → Check for updates**, or use the **Vault → Check for Updates…** menu.

### One-time setup (so the app knows where to look)
1. Create a free GitHub account and a **public** repository called `password-vault`. Installed apps can only download from a public repository. It holds only the app's code: your passwords never leave your computer.
2. In `package.json`, set `"owner"` to your GitHub username (already set to `hibbertmatt4`).
3. Upload this folder to the repository, leaving out `node_modules` and `dist`.
4. Install the version that has your username in it. Older copies don't know where to look for updates.

### Releasing an update
1. Change `"version"` in `package.json`, for example `1.2.0` → `1.3.0`. The number must go up.
2. In GitHub Desktop, click **Commit to main**, then **Push origin**.

That's all. GitHub notices the new version number and builds and publishes the release automatically. After about 5–10 minutes, the Windows and Mac installers appear on the **Releases** page, and every installed copy shows the update notification. Progress shows in the repository's **Actions** tab.

If you push without changing the version number, nothing is released; the Actions run just says "already released". To re-run a release by hand, go to **Actions → Build and release → Run workflow**.

## For developers
```
npm install
npm start          # run the app
npm test           # vault encryption tests
npm run dist:win   # build Windows installer
```
