# Password Vault

An offline, encrypted password manager for Windows and Mac.

## Features
- One master password unlocks everything. It is never stored anywhere.
- Your vault is encrypted with **AES-256-GCM**. The key comes from your master password via **scrypt**. There's no account and no Password Vault server. The vault stays on your computer, or in your own cloud drive if you turn on sync.
- Add, edit, delete and search your logins (name, username, password, website, notes).
- **Quick edit and delete:** hover over a login in the sidebar (or open it) for ✎ **Edit** and 🗑 **Delete** buttons; folders have the same buttons for renaming and deleting. Clicking a folder also opens its menu with **Rename** and **Delete** at the top, and right-clicking a login offers **Edit**, **Remind me** and **Delete**.
- **Formatted notes**, like writing an email or a Word document. The toolbar above Notes has:
  - **Text:** size (Small to Huge), **bold**, *italic*, underline, ~~strikethrough~~ and text color.
  - **Lights up:** a toolbar button is shaded while the cursor is in something that uses it, such as bold text, a highlighted or colored part, a non-normal size, a list, an alignment, or inside a table. The pages are wide enough for the whole toolbar to fit on one line (in a narrow window it wraps).
  - **Colors, like Word:** the highlight and text color buttons (and the table fills) open a drop-down with **Automatic** (or **No Color**), a grid of 60 *Theme Colors* (ten hues, light to dark, plus greys) and a row of 10 *Standard Colors*, your *Recent Colors*, and **More Colors…**, which opens a color square, a hue slider and a box for a color code (e.g. `#12ab9c`) so you can pick any color at all. The bar under the highlight and text color icons shows the color last used.
  - **Undo / Redo:** buttons at the left of the toolbar, and **Ctrl+Z** (**⌘Z**) / **Ctrl+Y** (**⇧⌘Z**), also the Edit menu. They undo everything in the notes, including Hide / Unhide, table fills, rows and picture sizes (not only typing). Typing in one go counts as one step.
  - **Layout:** bulleted and numbered lists, and align left, centre or right.
  - **Tables:** click the table button and pick a size from the grid. Inside a table, the same button can insert or delete rows and columns, or delete the table, and **Fill cell…**, **Fill row…**, **Fill column…** or **Fill table…** colors it (the same color drop-down; *No Color* removes it). **Ctrl/⌘ + drag** down a column (or over a block of cells) picks just those cells, which are tinted: Bold, colors and the rest of the toolbar then apply to only those cells, and the table menu gets **Fill N selected cells…**. **Tab** moves to the next cell, and pressing it in the last cell adds a row.
  - **Tab elsewhere:** adds a few spaces (it never jumps off to the next button); in a list, **Tab** / **Shift+Tab** indent and un-indent the item.
  - **Right-click menu:** right-clicking in the notes (or any text box) opens the app's own cream-and-tan menu (not the system's grey one): spelling suggestions and **Add to dictionary** for a misspelled word, **Cut / Copy / Paste**, **Hide (like a password)** or **Unhide** in the notes, and **Select all**.
  - **Scroll bars:** every scroll bar in the app (the main page, the sidebar, notes, lists and pop-ups) is the same slim, rounded one in the app's colors.
  - **Look:** selected text is a soft tan, the cursor is green, and clicking into the notes (or any box) gives it a tan outline, to match the rest of the app.
  - **Clear formatting** removes formatting from the selected text.
  - **Shortcuts:** Ctrl/Cmd+B, I, U and Z work as usual. Ctrl/Cmd+Shift+X is strikethrough.
  - **Pasting:** text pasted from Word, Outlook or a web page keeps its bold, italics, underline, colors, sizes, lists and tables. Pictures, links and anything else are removed.
  - **Older versions:** the formatting syncs with everything else. A computer still on an older version shows the notes as plain text. If it edits them, the plain text wins.
- **Hiding part of a note:** select text in the notes and click **Hide** in the toolbar. When you open the login, that part shows as •••••••• with a **Show** button (and **Hide** to cover it again), like a password, so sensitive details aren't on screen as soon as you click the login. While hidden, the text isn't even in the page. To un-hide it for good, put the cursor inside it while editing and click **Unhide**.
  - **Inside tables:** you can select across several cells (or from text into a table) and Hide; each cell's part is hidden on its own, so the table stays intact.
  - **Copying a hidden part:** after you press **Show**, a **Copy** button appears beside it and copies everything in that part (all its lines). Then **Hide** covers it again.
  - **Right-click:** select text in the notes and right-click, and the menu has **Hide (like a password)**; inside a hidden part it says **Unhide**.
  - **Several at once:** hold **Ctrl** (Windows) or **⌘** (Mac) and double-click words (or drag over text) in different places (different lines, even); all of them stay highlighted. In the editor, **any button in the toolbar** (Bold, Italic, color, highlight, size, lists…) and **Hide** (the button or the right-click menu) apply to all of them; on a login's page, **Ctrl/⌘+C** copies them, one per line (or right-click → *Copy*). A normal click, or Esc, clears them.
  - **Older versions:** a computer on an older version shows the whole note without hiding anything.
- **Subsites:** under **Website** in the editor, **+ Add a subsite** adds another page of that website (such as `bank.com/billing`) with a short description. On the login's page, under the website, a **Subsites** dropdown opens to show them indented beneath the website, each with its own **Open** button, so you can go straight to the page you want instead of the main site. Up to 30 per login; searching also finds subsites by address or description. A computer on an older version keeps them but doesn't show them.
- **Notes (no password):** click **+ Add** and choose **Note** (also in a folder's **+** and right-click menus, and when right-clicking empty space in the sidebar). A note is just a name, a folder, and notes (formatting, hidden parts, pictures, files and reminders all work). It has no username, password or website.
- **Pictures in notes:**
  - **Adding them:** click the picture button in the notes toolbar, paste one (e.g. a screenshot), or drop picture files onto the notes.
  - **Size:** pictures are made smaller (at most 1600 pixels across) so the vault stays quick to sync.
  - **Changing them:** click a picture to make it **Small**, **Medium** or **Full width**, save it, or remove it.
  - **Viewing a login:** click a picture there to save it.
- **Files on a login:** in the editor, **Files → Attach a file** (or drop non-picture files onto the notes) adds PDFs, documents, scans or anything else.
  - **Drag a file in from anywhere:** drag a file from your computer over the window and a dashed "Drop to add the file…" frame appears.
    - Drop it on an open login's page and it's added straight away (no need to press Edit).
    - Drop it on a login in the sidebar to add it to that login. Hover over a closed folder for a moment and it opens, so you can reach the login inside.
    - While editing a login, it joins the files that are saved with it.
  - **Limits:** up to 20 files per login, 10 MB each and 25 MB per login. Every file is encrypted inside your vault and syncs with it.
  - **On the login's page:** each file has **Save**. Pictures, PDFs and text files (txt, csv, md, json…) have **Preview**, which shows them inside the app without writing anything to disk. Other everyday documents have **Open**.
  - **Opening a file:** this puts a temporary decrypted copy in a private folder that is deleted when the vault locks or Password Vault quits.
  - **Programs** and other unusual file types can only be saved, never opened from the app.
  - **Older versions:** a computer still on an older version keeps the files but doesn't show them, and shows notes without pictures.
- **Spell check** in the Notes box (and in reminders): misspelled words are underlined; right-click one for suggestions or **Add to dictionary**. It uses your computer's own spell checker, so nothing is sent anywhere. Names, usernames, websites and passwords are never spell-checked.
- **Reminders:** get a notification with your own message, e.g. *"Delete my old Netflix password"*.
  - **Making one:**
    - While adding or editing a login, use **Add a reminder** under Notes. For a login that already exists it's set straight away and shows in **Settings → Reminders** at once; for a brand-new login it's set when you save it.
    - Or open a login and click **Remind me**.
    - Or go to **Settings → Reminders → New reminder** for one that isn't about a login.
  - **When:**
    - **On a date** (the first choice, and the one you see by default): pick a day on the calendar, set the time with AM / PM, or use a quick pick: **Tomorrow 9 AM**, **Next Monday** or **End of month**. Only a date can **repeat**, so the Repeat choices appear here.
    - **After a timer:** use − / + and choose minutes, hours, days or weeks. A timer goes off once, so there are no Repeat choices.
      - **Typing a date:** type it in the box above the calendar and press Enter, e.g. *3/15/2027* (in your computer's date order), *2027-03-15*, *March 15* (the next one coming up), *15 Mar 2027* or *tomorrow*.
      - **Jumping ahead:** click the month name to pick a month and year. The arrows then move a year at a time.
    - The line at the bottom always says exactly when you'll get it.
  - **Repeat:** **Never**, **Daily**, **Weekly**, **Monthly**, **Month end** or **Yearly**, e.g. *"Netflix renews"* every month on your billing date.
    - **Monthly** reminders on the 29th–31st fall on the last day of shorter months.
    - **Month end** is always the last day of the month: 28th or 29th in February, 30th or 31st otherwise.
  - **Arriving:** as a system notification even while the window is closed or the vault is locked. One that came due while the computer was off arrives when Password Vault next starts, marked with when it was due. A repeating reminder that was missed several times arrives once, then carries on. Clicking it opens the login it's about.
  - **Missed reminders:** if one went off while you weren't looking at the app, then the first time you open Password Vault afterwards (even at the lock screen) a message appears in the corner, *"A reminder went off"*, listing what it was and when. It stays until you close it with the **X**, so you can't miss it. Opening the app by clicking the reminder's own notification counts as seeing it, so no message appears for that one.
  - **Seeing them:**
    - **Settings → Reminders** lists every upcoming reminder, with its repeat and login, then the ones **Sent recently** (last 60 days).
    - Click a reminder there to open its login.
    - Each login's page and editor also show its own reminders.
  - **Editing:** **Edit** on an upcoming reminder changes its message, time or repeat. **Edit** on one under *Sent recently* opens it with its message filled in, so you can pick a new time or make it repeat; saving moves it back to *Upcoming*.
  - **On all your computers:** when your vault is synced, reminders are too. One made on your Windows PC shows up on your Mac (and the other way round), including edits, cancellations and which ones have been sent. They're stored encrypted in the synced vault file, and each computer reads them even while locked, so they go off wherever Password Vault is running. (Both computers need this version or newer. Reminders you already had join in the first time you unlock after updating.) If you don't use sync, they stay on that computer.
  - **Cancelling:** use **Cancel** on any reminder. Deleting a login also cancels its reminders.
  - **Updates and your reminders:** they live in their own file on your computer (`reminders.json` in Password Vault's data folder), which updating never touches. It's written safely (to a temporary file first) with a backup copy beside it; if the file is ever damaged the backup is used, and the damaged one is kept aside rather than overwritten. A one-time reminder that has gone off moves from *Upcoming* to *Sent recently* (for 60 days).
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
  - **Folders inside folders:** right-click a folder and choose **New folder inside**, or drag a folder onto another folder. Drag it to empty space (or choose **Move out of**) to bring it back up a level. Folders can go up to 8 levels deep.
  - **Fill it:** drag logins onto a folder, or out of it to empty space. You can also right-click a login and choose **Move to folder**, or pick a folder in the login's **Folder** dropdown.
  - **Opening and closing:** left-click anywhere on a folder to open or close it.
  - **Folder menu:** right-click a folder for **Add a password / note to this folder**, **New folder inside**, open/close, rename, move out or delete. On hover, **+** adds a password or note straight into it, and the pencil and bin rename or delete it.
  - **Deleting a folder** never deletes its logins or the folders inside it; they move up a level.
  - Folders, including empty ones, sync between your computers.
- **Icons:** click **Icon** next to the name to choose:
  - **Logos:** about 3,500 brands. With nothing typed you see the everyday ones (about 480: banks and payment apps, shops, streaming and subscriptions, business and company-formation services such as Plaid, Bloomberg, Amazon Seller, Delaware.gov, RentCast, Northwest Registered Agent, LEI and Design.com, photo and video editing, databases, airlines and more). **Type a name to search all of them**; names that start with what you typed come first.
  - **Emoji:** pick one, or type or paste any emoji.
  - **Upload:** your own image. It's cropped to a square, made small and stored encrypted in your vault, so it syncs with everything else. **Choose an image…** (and **Use the letter** on the Letter tab) sit next to **Cancel**.
  - **Spendoza:** the Spendoza logo is in the Logos list, and a login named or linked to Spendoza picks it automatically. (More of your own logos: put a PNG in `scripts/custom-logos/`, then run `npm run customlogos` and `npm run icons`.)
  - **Letter:** the first letter of the name.
- **Automatic logos:** if you don't choose an icon, a matching logo is shown automatically when the name or website matches a well-known brand (e.g. "GitHub", `netflix.com` or `corp.delaware.gov`). Only the everyday ones do this, so a login called "Home" never gets a logo by accident; the rest you choose yourself in the picker.

Brand logos come from [Simple Icons](https://simpleicons.org) (CC0). Brand names and logos are trademarks of their owners and are only used to label your own accounts. Some big names aren't in Simple Icons (e.g. SoFi, Capital One, Plaid, Hulu, Microsoft, Amazon Seller). For about 150 of them the real logo was fetched once, from the brand's own website (its app icon / favicon, shrunk to a 96-pixel square, saved inside the app by `npm run logos`; the app itself never goes on the internet for logos). A few (Lowe's, IRS, SAM.gov, TurboTax, JOANN, Gap, Dick's, PetSmart, Delaware E-Corp, Kindle, OneDrive, SQL Server, Snapseed, IBM) have no usable picture and keep a lettered badge in the brand's color. You can always use **Upload** for any logo you prefer.

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

**Changes taking a while to arrive (iCloud Drive on a Mac)**
iCloud brings a changed file down lazily, so a Mac can keep showing the old vault until something looks at the folder (which is why opening it in Finder made everything appear). While your vault is in iCloud Drive, Password Vault now asks iCloud for the newest copy itself: every 30 seconds, and whenever its window opens. **Settings → Sync between your computers → Sync now** does it straight away and merges what arrived. (If iCloud refuses the request, the reason is written to `logs/sync.log` in Password Vault's data folder.)

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

## Text size (zoom)
- **Keyboard:** **Ctrl** (Windows) or **⌘** (Mac) with **+** zooms in, with **−** zooms out, and with **0** goes back to normal size. Ctrl + the mouse wheel (or a pinch on a Mac trackpad) works too.
- **Settings → Text size:** **−** and **+** buttons with the current size (60% to 200%), and **Back to 100%**. The **View** menu has the same.
- Everything inside the window scales together (text, buttons, spacing). The green title bar at the top (logo, menus) stays the same real size at every zoom, so it always lines up with the window's own minimise / maximise / close buttons (or the Mac traffic lights), with no gap. Zoomed in a lot, the sidebar gets narrower and the window's smallest size grows to make room. The size is remembered on each computer.

## Showing passwords
- **Hides itself:** when you press **Show** on a password (a login's page or the editor) or on a hidden part of a note, it hides again by itself after **30 seconds**. Pressing **Hide**, opening another login, or locking hides it sooner.
- **Changing the time:** **Settings → Showing passwords** has **Unlimited**, **30 seconds**, **1 minute**, **3 minutes**, **5 minutes** and **Custom**. Custom has **hours : minutes : seconds** wheels: scroll the mouse wheel over one, click its ▲ ▼, or type a number. Choose at least 1 second (use **Unlimited** for no limit). It's a setting for this computer.

## Running in the background
- **Closing the window:** Password Vault **locks** and keeps running in the **system tray** (Windows, by the clock) or the **menu bar** (Mac). It keeps checking for updates and can notify you.
- **Full screen on a Mac:** closing or quitting (⌘Q) while the window is full screen first leaves full screen, then hides, so no empty black screen is left behind.
- **Opening it again:** click the tray icon (Windows) or choose **Open Password Vault** from its menu.
- **Quitting:** choose **Quit Password Vault** from the same menu. On a Mac, **⌘Q** and **Vault → Quit** close the window and also remove the Dock icon (no dot underneath), leaving only the menu bar icon, so Password Vault keeps checking for updates and sending notifications but doesn't look like it's still open. Click the menu bar icon → **Open Password Vault** to bring it (and its Dock icon) back; its **Quit Password Vault** really quits.
- **Window shortcuts (Windows and Mac):** **Ctrl/⌘+M** minimises, **Ctrl/⌘+Shift+M** maximises (and restores), and **F11** (Windows) or **⌃⌘F** (Mac) toggles full screen. They're also in the **Window** menu.
- **Starting at sign-in:** by default it also starts quietly in the tray when you sign in to your computer, so update notifications arrive even if you don't open it.
- **Turning these off:** **Settings → Background & startup**.

## Updates
The app checks for new versions when it starts, every 30 minutes, when your computer wakes up, and when you open the window. When one is found:
- **Both Windows and Mac:** the update downloads by itself in the background, even with the window closed. As soon as the window is closed into the tray / menu bar (so the vault is locked and nothing can be lost) it installs silently and Password Vault starts again quietly, with a notification *"Password Vault was updated"*. You never run an installer or drag anything. If the window is open, the banner offers **Restart & update**, or just close the window.
- **Your unfinished work is saved first:** if you're in the middle of adding or editing a login or note when you press **Restart & update** (or quit, or close the window), Password Vault saves what you've typed before it closes, so nothing is lost. A brand-new entry with no name is saved as "Untitled", a completely empty new one is dropped, and an entry you didn't change isn't touched. After you unlock again it says what it saved.
- **Pop-up buttons stay in view:** in any pop-up (Set reminder, Cancel, the icon picker…) the buttons at the bottom stay visible while the rest of the pop-up scrolls, so you always see what to click to save.
- **Ctrl+S saves:** while adding or editing a login or note, press **Ctrl+S** (**⌘S** on a Mac) to save it, the same as the Save button.
- **Clicking away saves too:** if you're adding or editing a login or note and click another login, **Settings**, **+ Add**, an Edit button, or **Lock**, what you typed is saved (a toast says *Saved "name"*) instead of being thrown away. Only **Cancel** (or Esc) discards your changes. A completely empty new entry is not kept. (If the vault locks itself after being idle, or your computer sleeps, an unsaved entry can't be saved, because the vault is already closed.)
- **Turning it off:** **Settings → Background & startup → Install updates automatically**. Then you choose when with **Restart & update**.
- **Mac, how it works:** Apple only lets *signed* apps use the standard updater, and this app isn't signed, so Password Vault does it itself. It downloads the release, checks it against the fingerprint (SHA-512) published with it, unpacks it, and a tiny helper swaps the new app in once the old one has quit. This needs Password Vault to be in your **Applications** folder (not running from the disk image). If anything goes wrong (no permission to replace the app, the download can't be unpacked…) it doesn't leave you stuck: you still get the "update available" notification, and Settings and the banner show **Download** with the reason in brackets. If an automatic install ever fails to swap the app in, it remembers and uses **Download** from then on, until you've installed a newer version yourself. The reason for any failure is also written to `logs/updater.log` in Password Vault's data folder (`~/Library/Application Support/Password Vault` on a Mac).
- **Disk space:** an update needs about 1 GB free while it downloads and unpacks. Password Vault checks first; if there isn't room, it says so in plain words (Settings, and the banner) and tries again at the next check, and it never leaves a half-finished download behind. On a Mac the finished app is moved into place rather than copied, so installing needs no extra space.
- There's a banner in the app and a dot on **Settings**. Update notifications can be turned off in **Settings → Notifications → App updates**.

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
