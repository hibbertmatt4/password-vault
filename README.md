# Password Vault

An offline, encrypted password manager for Windows and Mac.

## Features
- One master password unlocks everything. It is never stored anywhere.
- Your vault is encrypted with **AES-256-GCM**. The key comes from your master password via **scrypt**. There's no account and no Password Vault server. The vault stays on your computer, or in your own cloud drive if you turn on sync.
- Add, edit, delete and search your logins (name, username, password, website, notes).
- **Quick edit and delete:** hover over a login in the sidebar (or open it) for ✎ **Edit** and 🗑 **Delete** buttons; folders have the same buttons for renaming and deleting. Clicking a folder also opens its menu with **Rename** and **Delete** at the top, and right-clicking a login offers **Edit**, **Remind me** and **Delete**.
- **Formatted notes**, like writing an email or a Word document. The toolbar above Notes has:
  - **Text:** size (Small to Huge), **bold**, *italic*, underline, ~~strikethrough~~ and text colour.
  - **Highlight:** yellow, green, blue, pink or orange, or **No highlight**.
  - **Layout:** bulleted and numbered lists, and align left, centre or right.
  - **Tables:** click the table button and pick a size from the grid. Inside a table, the same button can insert or delete rows and columns, or delete the table. **Tab** moves to the next cell, and pressing it in the last cell adds a row.
  - **Clear formatting** removes formatting from the selected text.
  - **Shortcuts:** Ctrl/Cmd+B, I, U and Z work as usual. Ctrl/Cmd+Shift+X is strikethrough.
  - **Pasting:** text pasted from Word, Outlook or a web page keeps its bold, italics, underline, colours, sizes, lists and tables. Pictures, links and anything else are removed.
  - **Older versions:** the formatting syncs with everything else. A computer still on an older version shows the notes as plain text. If it edits them, the plain text wins.
- **Pictures in notes:**
  - **Adding them:** click the picture button in the notes toolbar, paste one (e.g. a screenshot), or drop picture files onto the notes.
  - **Size:** pictures are made smaller (at most 1600 pixels across) so the vault stays quick to sync.
  - **Changing them:** click a picture to make it **Small**, **Medium** or **Full width**, save it, or remove it.
  - **Viewing a login:** click a picture there to save it.
- **Files on a login:** in the editor, **Files → Attach a file** (or drop non-picture files onto the notes) adds PDFs, documents, scans or anything else.
  - **Limits:** up to 10 MB each and 25 MB per login. Every file is encrypted inside your vault and syncs with it.
  - **On the login's page:** each file has **Save…**, and everyday documents and pictures also have **Open**.
  - **Opening a file:** this puts a temporary decrypted copy in a private folder that is deleted when the vault locks or Password Vault quits.
  - **Programs** and other unusual file types can only be saved, never opened from the app.
  - **Older versions:** a computer still on an older version keeps the files but doesn't show them, and shows notes without pictures.
- **Spell check** in the Notes box (and in reminders): misspelled words are underlined; right-click one for suggestions or **Add to dictionary**. It uses your computer's own spell checker, so nothing is sent anywhere. Names, usernames, websites and passwords are never spell-checked.
- **Reminders:** get a notification with your own message, e.g. *"Delete my old Netflix password"*.
  - **Making one:**
    - While adding or editing a login, use **Add a reminder** under Notes. It's saved when you save the login.
    - Or open a login and click **Remind me**.
    - Or go to **Settings → Reminders → New reminder** for one that isn't about a login.
  - **When:**
    - **After a timer:** use − / + and choose minutes, hours, days or weeks.
    - **On a date:** pick a day on the calendar, set the time with AM / PM, or use a quick pick: **Tomorrow 9 AM**, **Next Monday** or **End of month**.
      - **Typing a date:** type it in the box above the calendar and press Enter, e.g. *3/15/2027* (in your computer's date order), *2027-03-15*, *March 15* (the next one coming up), *15 Mar 2027* or *tomorrow*.
      - **Jumping ahead:** click the month name to pick a month and year. The arrows then move a year at a time.
    - The line at the bottom always says exactly when you'll get it.
  - **Repeat:** **Never**, **Daily**, **Weekly**, **Monthly**, **Month end** or **Yearly**, e.g. *"Netflix renews"* every month on your billing date.
    - **Monthly** reminders on the 29th–31st fall on the last day of shorter months.
    - **Month end** is always the last day of the month: 28th or 29th in February, 30th or 31st otherwise.
  - **Arriving:** as a system notification even while the window is closed or the vault is locked. One that came due while the computer was off arrives when Password Vault next starts, marked with when it was due. A repeating reminder that was missed several times arrives once, then carries on. Clicking it opens the login it's about.
  - **Seeing them:**
    - **Settings → Reminders** lists every upcoming reminder, with its repeat and login, then the ones **Sent recently** (last 60 days).
    - Click a reminder there to open its login.
    - Each login's page and editor also show its own reminders.
  - **Cancelling:** use **Cancel** on any reminder. Deleting a login also cancels its reminders.
  - **Where they're kept:** on that computer only, sealed by the operating system. They don't sync.
- Built-in strong password generator and a strength meter.
- Copied passwords are **wiped from the clipboard after 30 seconds**.
- **Auto-locks** after 5 minutes of inactivity, or when your computer locks or sleeps. You can also lock it yourself with Ctrl+L / Cmd+L.
- Repeated wrong master passwords get progressively slower.
- The same green title bar on both systems: the logo, then the **Vault / Edit / Window** menus (on a Mac they sit beside the window buttons, and the usual menu bar at the top of the screen still works too).

> ⚠️ If you forget your master password, your data **cannot be recovered**.

## Folders and icons
- **Folders:**
  - **Make one:** click **New folder** next to *Your logins*, or right-click any empty space in the sidebar.
  - **Folders inside folders:** click a folder and choose **New folder inside**, or drag a folder onto another folder. Drag it to empty space (or choose **Move out of**) to bring it back up a level. Folders can go up to 8 levels deep.
  - **Fill it:** drag logins onto a folder, or out of it to empty space. You can also right-click a login and choose **Move to folder**, or pick a folder in the login's **Folder** dropdown.
  - **Folder menu:** click a folder for **Add a password to this folder**, **New folder inside**, open/close, rename, move out or delete. The small arrow opens and closes it, and **+** on hover adds a password straight into it.
  - **Deleting a folder** never deletes its logins or the folders inside it; they move up a level.
  - Folders, including empty ones, sync between your computers.
- **Icons:** click **Icon** next to the name to choose:
  - **Logos:** almost 300 brands: banks and payment apps, streaming and subscriptions, photo and video editing, databases, airlines, shops and more.
  - **Emoji:** pick one, or type or paste any emoji.
  - **Upload:** your own image. It's cropped to a square, made small and stored encrypted in your vault, so it syncs with everything else.
  - **Letter:** the first letter of the name.
- **Automatic logos:** if you don't choose an icon, a matching logo is shown automatically when the name or website matches a known brand (e.g. "GitHub" or `netflix.com`).

Brand logos come from [Simple Icons](https://simpleicons.org) (CC0). Brand names and logos are trademarks of their owners and are only used to label your own accounts. Some big names aren't in Simple Icons (e.g. SoFi, Capital One, Chime, Hulu, Microsoft); these get a lettered badge in the brand's colour instead. You can always use **Upload** for the real logo.

**Getting back to the blank screen:** click the open login again, click empty space in the sidebar or on the page, or press **Esc**. (An open editor is never closed this way, so you can't lose unsaved changes.)

## Unlock with Touch ID or Windows Hello
On a Mac with **Touch ID**, or a Windows PC with **Windows Hello** (fingerprint reader, face camera or Hello PIN), go to **Settings → Unlock with Touch ID / Windows Hello → Turn on**. Confirm with your master password and your fingerprint or face.

- **Unlocking:** the lock screen shows **Unlock with Touch ID / Windows Hello**. When the app opens, it asks straight away.
- **Confirming it's you:** anywhere else the app asks for your master password, such as turning on sync, you can tap **Use Touch ID / Windows Hello instead**. Two exceptions need the typed password: **changing your master password**, and combining with a different vault from another computer.
- **Master password still needed:** once a week, after the master password is changed on any of your computers, and whenever you turn the feature off and on again.
- **Per computer:** it's set up separately on each computer, and the option only appears where the hardware is available.
- **How it's protected:** your vault key is kept sealed by the operating system (Mac Keychain / Windows protected storage) and only released after Touch ID or Windows Hello confirms it's you.

## Where your data lives
- **Not syncing:** Windows `%APPDATA%\Password Vault\vault.json`, Mac `~/Library/Application Support/Password Vault/vault.json`
- **Syncing:** a `Password Vault` folder in the cloud drive you chose, for example `OneDrive\Password Vault\vault.json`

Backups stay on each computer in the `backups` folder next to the "not syncing" location above. Every file is encrypted.

## Syncing between computers
Your passwords can be shared between your Mac and Windows computers through a cloud drive you already use: **iCloud Drive, OneDrive, Google Drive or Dropbox**. Password Vault finds these automatically. You can also pick any folder your cloud app keeps in sync.

**First computer**
- **New vault:** under **Where to keep your vault**, pick your cloud drive.
- **Existing vault:** go to **Settings → Sync between your computers → Set up sync**, pick the drive, and confirm with your master password.

**Switching to a folder whose vault has a different master password**
If the folder you pick (with **Set up sync** or **Change folder**) already has a vault with a different master password, Password Vault tells you so and asks you to type that vault's password. Your logins from this computer are combined into it, and from then on **this computer uses that vault's master password**; your old one stops working here. You'll be told this again whenever you switch to a folder with another password.

**Other computers**
1. Install the cloud drive's app and sign in.
2. Open Password Vault and click **Already use Password Vault on another computer? Connect to it**.
3. Pick the same drive and unlock with the same master password.

**How it behaves**
- **Speed:** changes show up on your other computers within a few seconds of the cloud drive syncing them, even while the app is open.
- **Simultaneous edits:** if you edit on two computers before they sync, both sets of changes are kept. For the same login, the newest edit wins. Deleted logins stay deleted.
- **Notifications:** when a password is added, changed or deleted on another computer, you get a system notification (Windows notification centre / Mac Notification Centre) naming it, e.g. *"Password updated on your Mac — GitHub"*.
  - **When:** whether the window is open, closed to the tray / menu bar, or the vault is locked, like Mail. Changes made while your computer was off are reported when Password Vault starts at sign-in. A fully quit app can't notify, so keep **Settings → Background & startup** switched on.
  - **How it can name logins while locked:** each save also stores a short, encrypted list of recent changes (login names only, never usernames or passwords). Its key is derived one-way from your vault key, and each computer keeps it sealed by the operating system after you've unlocked there once. It can't be used to open your vault.
  - **Fallback:** if that list can't be read (e.g. the master password was just changed on another computer), you get a general *"Your passwords were changed on another computer"* instead.
  - **Choose which ones:** **Settings → Notifications** has a switch each for new, changed and deleted passwords, and for app updates.
  - **This computer or all of them:** under **Use these choices on**, pick **All my computers** (the default) to apply your switches to every computer that syncs this vault, or **Only this computer** to give this computer its own choices. A computer set to *Only this computer* is never changed by the others. The shared choices travel in the synced file, encrypted like the change list, so even a locked computer follows them.
  - **Inside the app:** while the vault is open you also get a short message in the app for every change from another computer, including new icons and folders, e.g. *"GitHub: icon changed on your Mac"*.
  - **Mac:** allow notifications for Password Vault in **System Settings → Notifications** if they don't appear. Password Vault opts out of macOS "App Nap", so it keeps checking while it sits in the menu bar.
  - **Troubleshooting:** each check is noted (counts only, no login names) in `logs/sync.log` in Password Vault's data folder.
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

## Running in the background
- **Closing the window:** Password Vault **locks** and keeps running in the **system tray** (Windows, by the clock) or the **menu bar** (Mac). It keeps checking for updates and can notify you.
- **Opening it again:** click the tray icon (Windows) or choose **Open Password Vault** from its menu.
- **Quitting:** choose **Quit Password Vault** from the same menu.
- **Starting at sign-in:** by default it also starts quietly in the tray when you sign in to your computer, so update notifications arrive even if you don't open it.
- **Turning these off:** **Settings → Background & startup**.

## Updates
The app checks for new versions when it starts, every 30 minutes, when your computer wakes up, and when you open the window. When one is found:
- **Windows:** the update downloads by itself in the background, even with the window closed. You then get a notification, *"Password Vault update ready"*. Click it, then **Restart & update** (or it installs next time you quit).
- **Mac:** you get a notification straight away. Click **Download** to get the new version, then drag it into Applications. Unsigned Mac apps can't replace themselves.
- Either way, there's a banner in the app and a dot on **Settings**. Update notifications can be turned off in **Settings → Notifications → App updates**.

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
