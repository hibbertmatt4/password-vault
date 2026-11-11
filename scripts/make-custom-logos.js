// Turns the pictures in scripts/custom-logos/ (one PNG per logo, file name = logo id, e.g. spendoza.png) into small
// square PNGs saved in scripts/custom-logos.json, which build-brand-icons.js adds to the icon list.
// The picture is fitted inside a square (not cropped) on its own background colour. Run with `npm run customlogos`
// (needs Electron, for image drawing), then `npm run icons`.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 128;
const dir = path.join(__dirname, 'custom-logos');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const out = {};
  for (const file of fs.readdirSync(dir).filter((f) => /\.png$/i.test(f))) {
    const id = file.replace(/\.png$/i, '').toLowerCase();
    const dataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, file)).toString('base64');
    const png = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const probe = document.createElement('canvas');
        probe.width = img.width; probe.height = img.height;
        const pc = probe.getContext('2d');
        pc.drawImage(img, 0, 0);
        const [r, g, b] = pc.getImageData(2, 2, 1, 1).data; // the picture's own background colour
        const c = document.createElement('canvas');
        c.width = c.height = ${SIZE};
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
        ctx.fillRect(0, 0, ${SIZE}, ${SIZE});
        const scale = Math.min(${SIZE} / img.width, ${SIZE} / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (${SIZE} - w) / 2, (${SIZE} - h) / 2, w, h);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('could not read picture'));
      img.src = ${JSON.stringify(dataUrl)};
    })`);
    out[id] = { png: png.replace(/^data:image\/png;base64,/, '') }; // (just the base64, like brand-logos.json)
    console.log(id, Math.round(png.length / 1024) + ' KB');
  }
  fs.writeFileSync(path.join(__dirname, 'custom-logos.json'), JSON.stringify(out));
  app.exit(0);
});
