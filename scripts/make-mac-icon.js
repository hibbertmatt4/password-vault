// Makes build/icon-mac.png from build/icon.png, sized like other Mac apps.
// macOS icons leave a margin: the artwork is 824×824 in the middle of a 1024×1024 canvas, with a soft shadow
// underneath. (Windows icons fill the whole square, so build/icon.png stays as it is for Windows.)
// Run with: npx electron scripts/make-mac-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'build', 'icon.png');
const dest = path.join(__dirname, '..', 'build', 'icon-mac.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64');
  const out = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 1024;
      const g = c.getContext('2d');
      g.shadowColor = 'rgba(0, 0, 0, 0.28)';
      g.shadowBlur = 20;
      g.shadowOffsetY = 10;
      g.drawImage(img, 100, 100, 824, 824);
      resolve(c.toDataURL('image/png'));
    };
    img.src = ${JSON.stringify(dataUrl)};
  })`);
  fs.writeFileSync(dest, Buffer.from(out.split(',')[1], 'base64'));
  console.log('wrote', dest);
  app.exit(0);
});
