// Fetches a small real logo for each brand that Simple Icons doesn't carry, from the brand's own website
// (its apple-touch-icon / favicon), shrinks it to a 96-pixel square PNG, and saves them all in brand-logos.json.
// build-brand-icons.js then uses them instead of a lettered badge. Run with `npm run logos` (it needs Electron,
// for image resizing) only when the list changes; the app itself never goes on the internet for logos.
// Logos are trademarks of their owners, used only to label the user's own accounts.
'use strict';
const { app, net, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const DOMAINS = {
  sofi: 'sofi.com', capitalone: 'capitalone.com', citi: 'citi.com', ally: 'ally.com', chime: 'chime.com', schwab: 'schwab.com',
  fidelity: 'fidelity.com', vanguard: 'vanguard.com', usaa: 'usaa.com', pnc: 'pnc.com', truist: 'truist.com', santander: 'santanderbank.com',
  usbank: 'usbank.com', tdbank: 'td.com', navyfederal: 'navyfederal.org', marcus: 'marcus.com', synchrony: 'synchrony.com',
  creditkarma: 'creditkarma.com', acorns: 'acorns.com', betterment: 'betterment.com', etrade: 'etrade.com', webull: 'webull.com',
  affirm: 'affirm.com', experian: 'experian.com', hulu: 'hulu.com', disneyplus: 'disneyplus.com', peacock: 'peacocktv.com', sling: 'sling.com',
  siriusxm: 'siriusxm.com', deezer: 'deezer.com', microsoft: 'microsoft.com', outlook: 'outlook.com', microsoft365: 'microsoft365.com',
  teams: 'teams.microsoft.com', xbox: 'xbox.com', yahoo: 'yahoo.com', capcut: 'capcut.com', procreate: 'procreate.com', pixelmator: 'pixelmator.com',
  lightroom: 'lightroom.adobe.com', picsart: 'picsart.com', costco: 'costco.com', bestbuy: 'bestbuy.com', homedepot: 'homedepot.com',
  lowes: 'lowes.com', booking: 'booking.com', att: 'att.com', xfinity: 'xfinity.com',
  amazonseller: 'sellercentral.amazon.com', delawaregov: 'delaware.gov', rentcast: 'rentcast.io', northwest: 'northwestregisteredagent.com',
  lei: 'gleif.org', bloomberg: 'bloomberg.com', plaid: 'plaid.com', designcom: 'design.com', irs: 'irs.gov', uspto: 'uspto.gov', sba: 'sba.gov',
  samgov: 'sam.gov', legalzoom: 'legalzoom.com', zenbusiness: 'zenbusiness.com', bizee: 'bizee.com', harvardbusiness: 'delawareinc.com',
  registeredagentsinc: 'registeredagentsinc.com', ctcorporation: 'ctcorporation.com', doola: 'doola.com', rocketlawyer: 'rocketlawyer.com',
  carta: 'carta.com', docusign: 'docusign.com', dropboxsign: 'sign.dropbox.com', pandadoc: 'pandadoc.com', freshbooks: 'freshbooks.com',
  rippling: 'rippling.com', deel: 'deel.com', mercury: 'mercury.com', bluevine: 'bluevine.com', relay: 'relayfi.com', novo: 'novo.co',
  ramp: 'ramp.com', billcom: 'bill.com', turbotax: 'turbotax.intuit.com', hrblock: 'hrblock.com', microsoftazure: 'azure.microsoft.com',
  ibm: 'ibm.com', powerbi: 'powerbi.microsoft.com', monday: 'monday.com', smartsheet: 'smartsheet.com', segment: 'segment.com',
  amplitude: 'amplitude.com', ahrefs: 'ahrefs.com', moz: 'moz.com', sproutsocial: 'sproutsocial.com', fastmail: 'fastmail.com',
  bluehost: 'bluehost.com', dreamhost: 'dreamhost.com', hostgator: 'hostgator.com', siteground: 'siteground.com', weebly: 'weebly.com',
  jotform: 'jotform.com', toasttab: 'pos.toasttab.com', clover: 'clover.com', lightspeed: 'lightspeedhq.com', opentable: 'opentable.com',
  resy: 'resy.com', angi: 'angi.com', taskrabbit: 'taskrabbit.com', kraken: 'kraken.com', gemini: 'gemini.com', wealthfront: 'wealthfront.com',
  public: 'public.com', interactivebrokers: 'interactivebrokers.com', tastytrade: 'tastytrade.com', lendingclub: 'lendingclub.com',
  alibaba: 'alibaba.com', staples: 'staples.com', officedepot: 'officedepot.com', kohls: 'kohls.com', nordstrom: 'nordstrom.com',
  sephora: 'sephora.com', ulta: 'ulta.com', wayfair: 'wayfair.com', temu: 'temu.com', shein: 'shein.com', overstock: 'overstock.com',
  microcenter: 'microcenter.com', bhphoto: 'bhphotovideo.com', kroger: 'kroger.com', albertsons: 'albertsons.com', safeway: 'safeway.com',
  publix: 'publix.com', aldi: 'aldi.us', traderjoes: 'traderjoes.com', wholefoods: 'wholefoodsmarket.com', cvs: 'cvs.com',
  walgreens: 'walgreens.com', petco: 'petco.com', petsmart: 'petsmart.com', chewy: 'chewy.com', lululemon: 'lululemon.com', gap: 'gap.com',
  hm: 'hm.com', michaels: 'michaels.com', joann: 'joann.com', dollargeneral: 'dollargeneral.com', dollartree: 'dollartree.com',
  tjmaxx: 'tjmaxx.tjx.com', marshalls: 'marshalls.com', ross: 'rossstores.com', basspro: 'basspro.com', rei: 'rei.com',
  dickssportinggoods: 'dickssportinggoods.com', carmax: 'carmax.com', carvana: 'carvana.com', mercari: 'mercari.com', poshmark: 'poshmark.com',
  depop: 'depop.com', thredup: 'thredup.com', vinted: 'vinted.com', offerup: 'offerup.com', craigslist: 'craigslist.org', realtor: 'realtor.com',
  redfin: 'redfin.com',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const OUT = path.join(__dirname, 'brand-logos.json');
const SIZE = 96;

async function get(url, { text = false, max = 400 * 1024 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await net.fetch(url, { headers: { 'user-agent': UA, accept: text ? 'text/html' : 'image/*,*/*' }, redirect: 'follow', signal: ctl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max || !buf.length) return null;
    return { buf, type: res.headers.get('content-type') || '', url: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// icon links on the home page, best first (big apple-touch-icons, then the largest other icon)
function iconLinks(html, base) {
  const links = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (/rel\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    const href = (/href\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    if (!href || !/icon/i.test(rel) || /mask-icon/i.test(rel)) continue;
    const sizes = (/sizes\s*=\s*["'](\d+)x\d+/i.exec(tag) || [])[1];
    let url;
    try {
      url = new URL(href.replace(/&amp;/g, '&'), base).href;
    } catch {
      continue;
    }
    links.push({ url, apple: /apple-touch/i.test(rel), size: Number(sizes) || 0 });
  }
  return links.sort((a, b) => Number(b.apple) - Number(a.apple) || b.size - a.size);
}

function toLogo(buf) {
  let img;
  try {
    img = nativeImage.createFromBuffer(buf);
  } catch {
    return null;
  }
  if (!img || img.isEmpty()) return null;
  const { width, height } = img.getSize();
  if (width < 32 || height < 32) return null;
  const ratio = width / height;
  if (ratio > 1.15 || ratio < 0.87) return null; // not a square logo
  return img.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG();
}

async function logoFor(domain) {
  const page = await get(`https://${domain}/`, { text: true, max: 1.5 * 1024 * 1024 });
  const candidates = page && /html/i.test(page.type) ? iconLinks(page.buf.toString('utf8'), page.url) : [];
  candidates.push({ url: `https://${domain}/apple-touch-icon.png` }, { url: `https://${domain}/favicon.ico` });
  for (const c of candidates.slice(0, 6)) {
    const res = await get(c.url);
    if (!res || !/^image\/(png|jpe?g|x-icon|vnd\.microsoft\.icon|webp)/i.test(res.type)) continue;
    const png = toLogo(res.buf);
    if (png) return { png, from: c.url };
  }
  // last resort: Google's favicon cache (128 px)
  const g = await get(`https://www.google.com/s2/favicons?sz=128&domain=${domain}`);
  if (g) {
    const png = toLogo(g.buf);
    if (png) return { png, from: 'google-favicons', weak: true };
  }
  return null;
}

app.whenReady().then(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/electron|\.js$/i.test(a));
  let have = {};
  try {
    have = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  const ids = Object.keys(DOMAINS).filter((id) => !only.length || only.includes(id));
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const r = await logoFor(DOMAINS[id]);
      if (r) {
        have[id] = { png: r.png.toString('base64'), from: r.from, weak: !!r.weak };
        console.log(`ok   ${id} (${Math.round(r.png.length / 1024)} KB, ${r.weak ? 'google' : 'site'})`);
      } else console.log(`NONE ${id} (${DOMAINS[id]})`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  fs.writeFileSync(OUT, JSON.stringify(have));
  console.log(`saved ${Object.keys(have).length} of ${Object.keys(DOMAINS).length}`);
  app.exit(0);
});
