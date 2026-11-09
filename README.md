# Password Vault

An offline, encrypted password manager for Windows and Mac.

## Features
- One master password unlocks everything. It is never stored anywhere.
- Your vault is encrypted with **AES-256-GCM**. The key comes from your master password via **scrypt**. The vault never leaves your computer: no cloud, no account.
- Add, edit, delete and search your logins (name, username, password, website, notes).
- Built-in strong password generator and a strength meter.
- Copied passwords are **wiped from the clipboard after 30 seconds**.
- **Auto-locks** after 5 minutes of inactivity, or when your computer locks or sleeps. You can also lock it yourself with Ctrl+L / Cmd+L.
- Repeated wrong master passwords get progressively slower.

> ⚠️ If you forget your master password, your data **cannot be recovered**.

## Where your data lives
- Windows: `%APPDATA%\Password Vault\vault.json`
- Mac: `~/Library/Application Support/Password Vault/vault.json`

A `vault.json.bak` copy of the previous save is kept beside it. Both files are encrypted.
To back up, copy `vault.json` somewhere safe, such as a USB stick.
To move to another computer, put that file in the same location there.

## Installing on Windows
Run `dist\Password-Vault-Setup-<version>.exe`. The app isn't code-signed, so Windows SmartScreen may warn you. Click **More info → Run anyway**.

## Building the Mac version
Mac apps have to be built on a Mac. If you don't have one, GitHub can build it for free:

1. Create a free GitHub account and a new **private** repository.
2. Upload this folder to it, leaving out `node_modules` and `dist`.
3. Open the repo's **Actions** tab → **Build and release** → **Run workflow**.
4. After about 5–10 minutes, open the repository's **Releases** page and download the `.dmg` file. The Windows installer is on the same page.

The Mac app isn't signed by Apple. The first time you open it, **right-click the app → Open → Open**. On newer macOS versions you may instead need to go to **System Settings → Privacy & Security → Open Anyway**.

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
1. Change `"version"` in `package.json`, for example `1.1.0` → `1.2.0`. The number must go up.
2. Upload your changes to GitHub.
3. On GitHub, go to **Actions → Build and release → Run workflow**.

After about 5–10 minutes, a new Release appears with the Windows and Mac installers. Every installed copy will then show the update notification.

## For developers
```
npm install
npm start          # run the app
npm test           # vault encryption tests
npm run dist:win   # build Windows installer
```
