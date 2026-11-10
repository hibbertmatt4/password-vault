// Builds src/renderer/brand-icons.js: a curated set of well-known brand logos from Simple Icons
// (https://simpleicons.org, CC0). Run with `npm run icons` after changing the list below.
// Logos are trademarks of their owners and are shown only to label the user's own accounts.
'use strict';
const fs = require('fs');
const path = require('path');
const si = require('simple-icons');

const SLUGS = `
apple icloud google gmail googledrive youtube amazon primevideo netflix spotify max
facebook instagram whatsapp messenger x linkedin tiktok snapchat reddit pinterest discord telegram signal
slack zoom notion trello asana atlassian linear figma canva adobe evernote duolingo
github gitlab docker npm vercel heroku digitalocean cloudflare godaddy namecheap wordpress squarespace wix shopify
dropbox proton protonmail bitwarden 1password lastpass duckduckgo firefox googlechrome openai anthropic claude
paypal venmo cashapp stripe wise revolut robinhood coinbase binance visa mastercard americanexpress
chase bankofamerica wellsfargo intuit quickbooks mailchimp salesforce
ebay etsy walmart target starbucks uber lyft airbnb doordash ubereats instacart
expedia tripadvisor zillow southwestairlines delta unitedairlines americanairlines
steam epicgames playstation nintendo twitch hbo verizon tmobile
discover hsbc barclays monzo n26 nubank starlingbank deutschebank commerzbank caixabank hdfcbank icicibank
klarna afterpay zelle square googlepay applepay samsungpay amazonpay alipay payoneer paytm
paramountplus appletv applemusic youtubemusic youtubetv crunchyroll audible tidal soundcloud pandora
patreon substack medium vimeo kick dailymotion peloton strava fitbit garmin
adobephotoshop adobelightroom adobeillustrator adobeindesign adobepremierepro adobeaftereffects adobeacrobatreader
affinityphoto affinitydesigner gimp inkscape krita vsco sketch framer blender davinciresolve photopea
mysql postgresql mongodb redis sqlite mariadb supabase firebase neo4j elasticsearch cockroachlabs planetscale
airtable couchbase apachecassandra influxdb snowflake oracle amazonrds amazondynamodb amazonwebservices
grammarly calendly todoist dashlane nordvpn expressvpn protonvpn surfshark mullvad backblaze box googlephotos
aol zoho tutanota viber line wechat kakaotalk bluesky mastodon threads tumblr quora
roblox ea ubisoft riotgames battledotnet nike adidas ikea aliexpress rakuten
marriott hilton trivago ryanair easyjet lufthansa britishairways emirates qatarairways jetblue
grubhub deliveroo justeat mcdonalds spectrum vodafone
`.trim().split(/\s+/);

// Big names that Simple Icons doesn't carry (mostly banks). They get a lettered badge in the brand's colour
// instead of a drawn logo. `alias` lets a website like td.com or navyfederal.org pick the badge automatically.
const BADGES = [
  ['sofi', 'SoFi', '00A2C7', 'SoFi'],
  ['capitalone', 'Capital One', '004977', 'C1'],
  ['citi', 'Citi', '056DAE', 'citi', ['citibank']],
  ['ally', 'Ally Bank', '650360', 'ally'],
  ['chime', 'Chime', '1EC677', 'chime'],
  ['schwab', 'Charles Schwab', '00A0DF', 'CS', ['charlesschwab']],
  ['fidelity', 'Fidelity', '368727', 'F'],
  ['vanguard', 'Vanguard', '96151D', 'V'],
  ['usaa', 'USAA', '12395B', 'USAA'],
  ['pnc', 'PNC Bank', 'EF6A00', 'PNC'],
  ['truist', 'Truist', '2E1A47', 'T'],
  ['santander', 'Santander', 'EC0000', 'S', ['santanderbank']],
  ['usbank', 'U.S. Bank', '0C2074', 'US'],
  ['tdbank', 'TD Bank', '008A00', 'TD', ['td']],
  ['navyfederal', 'Navy Federal', '003865', 'NFCU'],
  ['marcus', 'Marcus by Goldman Sachs', '0E2F4F', 'M'],
  ['synchrony', 'Synchrony', 'FBC600', 'S', ['mysynchrony']],
  ['creditkarma', 'Credit Karma', '0F9D58', 'CK'],
  ['acorns', 'Acorns', '6CC04A', 'A'],
  ['betterment', 'Betterment', '1A73E8', 'B'],
  ['etrade', 'E*TRADE', '6633CC', 'E*'],
  ['webull', 'Webull', '1D4ED8', 'W'],
  ['affirm', 'Affirm', '4A4AF4', 'a'],
  ['experian', 'Experian', '1D4F91', 'E'],
  ['hulu', 'Hulu', '1CE783', 'hulu'],
  ['disneyplus', 'Disney+', '113CCF', 'D+'],
  ['peacock', 'Peacock', '000000', 'P', ['peacocktv']],
  ['sling', 'Sling TV', '0072CE', 'S', ['slingtv']],
  ['siriusxm', 'SiriusXM', '0000EB', 'SXM'],
  ['deezer', 'Deezer', 'A238FF', 'D'],
  ['kindle', 'Kindle', '232F3E', 'K'],
  ['microsoft', 'Microsoft', '5E5E5E', 'MS', ['live', 'microsoftonline']],
  ['outlook', 'Outlook', '0078D4', 'O'],
  ['microsoft365', 'Microsoft 365', 'D83B01', '365', ['office', 'office365']],
  ['onedrive', 'OneDrive', '0078D4', 'OD'],
  ['teams', 'Microsoft Teams', '6264A7', 'T', ['microsoftteams']],
  ['xbox', 'Xbox', '107C10', 'X'],
  ['yahoo', 'Yahoo', '6001D2', 'Y!'],
  ['sqlserver', 'SQL Server', 'CC2927', 'SQL', ['microsoftsqlserver']],
  ['capcut', 'CapCut', '000000', 'CC'],
  ['procreate', 'Procreate', '1E1E1E', 'P'],
  ['snapseed', 'Snapseed', '0F9D58', 'S'],
  ['pixelmator', 'Pixelmator Pro', '5856D6', 'Px'],
  ['lightroom', 'Lightroom', '31A8FF', 'Lr'],
  ['picsart', 'Picsart', 'C209C1', 'P'],
  ['costco', 'Costco', 'E31837', 'C'],
  ['bestbuy', 'Best Buy', '0046BE', 'BB'],
  ['homedepot', 'The Home Depot', 'F96302', 'HD'],
  ['lowes', "Lowe's", '004990', 'L'],
  ['booking', 'Booking.com', '003580', 'B.'],
  ['att', 'AT&T', '00A8E0', 'AT&T'],
  ['xfinity', 'Xfinity', '6138F5', 'X', ['comcast']],
];

for (const [id] of BADGES) {
  if (SLUGS.includes(id)) throw new Error(`badge "${id}" clashes with a Simple Icons logo`);
}

const all = Object.values(si).filter((i) => i && i.slug);
const bySlug = new Map(all.map((i) => [i.slug, i]));
const icons = [];
for (const slug of SLUGS) {
  const i = bySlug.get(slug);
  if (!i) {
    console.warn('not in simple-icons:', slug);
    continue;
  }
  icons.push({ id: slug, title: i.title, hex: i.hex, path: i.path });
}
const ids = new Set(icons.map((i) => i.id));
for (const [id, title, hex, text, alias] of BADGES) {
  if (ids.has(id)) continue; // a real logo already covers it
  icons.push(alias ? { id, title, hex, text, alias } : { id, title, hex, text });
}
icons.sort((a, b) => a.title.localeCompare(b.title));

const out = `// Generated by scripts/build-brand-icons.js from Simple Icons (CC0, https://simpleicons.org).
// Brand names and logos are trademarks of their respective owners.
window.BRAND_ICONS = ${JSON.stringify(icons)};
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'brand-icons.js'), out);
console.log(`wrote ${icons.length} brand icons (${Math.round(out.length / 1024)} KB)`);
