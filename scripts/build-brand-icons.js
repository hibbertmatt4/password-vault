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

// More business, shop and service names that Simple Icons doesn't carry. Same lettered badges. (Colours are
// close approximations; use Upload for the exact logo.)
BADGES.push(
  // business & company formation
  ['amazonseller', 'Amazon Seller', 'FF9900', 'a', ['sellercentral']],
  ['delawaregov', 'Delaware.gov', '1D4F91', 'DE', ['delaware']],
  ['delawareecorp', 'Delaware E-Corp', '0B3C74', 'eCorp', ['ecorp']],
  ['rentcast', 'RentCast', '1E40AF', 'RC'],
  ['northwest', 'Northwest Registered Agent', '1B5E3F', 'NW', ['northwestregisteredagent']],
  ['lei', 'LEI (GLEIF)', '0072BC', 'LEI', ['gleif']],
  ['bloomberg', 'Bloomberg', '000000', 'B'],
  ['plaid', 'Plaid', '111111', 'P'],
  ['designcom', 'Design.com', '5B3DF5', 'D', ['design']],
  ['irs', 'IRS', '0B3D91', 'IRS'],
  ['uspto', 'USPTO', '0B3A6F', 'PTO'],
  ['sba', 'SBA', '003875', 'SBA'],
  ['samgov', 'SAM.gov', '1B3A67', 'SAM'],
  ['legalzoom', 'LegalZoom', '2F6FB0', 'LZ'],
  ['zenbusiness', 'ZenBusiness', '2B2D7E', 'ZB'],
  ['bizee', 'Bizee (Incfile)', 'F26B21', 'bz', ['incfile']],
  ['harvardbusiness', 'Harvard Business Services', 'A41E34', 'HBS'],
  ['registeredagentsinc', 'Registered Agents Inc', '1F3A5F', 'RAI'],
  ['ctcorporation', 'CT Corporation', '003C71', 'CT', ['ctcorp']],
  ['doola', 'doola', '6C4BFF', 'd'],
  ['rocketlawyer', 'Rocket Lawyer', '1F4B99', 'RL'],
  ['carta', 'Carta', '0E7C7B', 'C'],
  ['docusign', 'DocuSign', 'FFCC22', 'DS'],
  ['dropboxsign', 'Dropbox Sign', '0061FF', 'DS', ['hellosign']],
  ['pandadoc', 'PandaDoc', '4CAF50', 'pd'],
  ['freshbooks', 'FreshBooks', '0075DD', 'FB'],
  ['rippling', 'Rippling', 'FEBB2E', 'R'],
  ['deel', 'Deel', '15357A', 'deel'],
  ['mercury', 'Mercury', '5266EB', 'M'],
  ['bluevine', 'BlueVine', '2B3FE0', 'bv'],
  ['relay', 'Relay', '0D7A4D', 'R'],
  ['novo', 'Novo', '5E34F5', 'N'],
  ['ramp', 'Ramp', 'E4F222', 'R'],
  ['billcom', 'Bill', '0B2A4A', 'bill', ['bill']],
  ['turbotax', 'TurboTax', 'D52B1E', 'TT'],
  ['hrblock', 'H&R Block', '00A758', 'HR'],
  ['microsoftazure', 'Microsoft Azure', '0078D4', 'Az', ['azure']],
  ['ibm', 'IBM', '1F70C1', 'IBM'],
  ['powerbi', 'Power BI', 'F2C811', 'PBI'],
  ['monday', 'monday.com', 'FF3D57', 'm'],
  ['smartsheet', 'Smartsheet', '0E6DC8', 'S'],
  ['segment', 'Segment', '52BD94', 'S'],
  ['amplitude', 'Amplitude', '1E61F0', 'A'],
  ['ahrefs', 'Ahrefs', '0070F3', 'a'],
  ['moz', 'Moz', '0099DB', 'M'],
  ['sproutsocial', 'Sprout Social', '59CB59', 'S'],
  ['fastmail', 'Fastmail', '0067B9', 'FM'],
  ['bluehost', 'Bluehost', '2065D1', 'bh'],
  ['dreamhost', 'DreamHost', '0073EC', 'DH'],
  ['hostgator', 'HostGator', 'FFC20E', 'HG'],
  ['siteground', 'SiteGround', '5A3AE0', 'SG'],
  ['weebly', 'Weebly', '1A8FFF', 'W'],
  ['jotform', 'Jotform', 'FF6100', 'J'],
  ['toasttab', 'Toast', 'FF4C00', 'T', ['toast']],
  ['clover', 'Clover', '37B24D', 'C'],
  ['lightspeed', 'Lightspeed', 'E4002B', 'L'],
  ['opentable', 'OpenTable', 'DA3743', 'OT'],
  ['resy', 'Resy', 'FF5F5F', 'R'],
  ['angi', 'Angi', 'FF6153', 'A'],
  ['taskrabbit', 'TaskRabbit', '00B9A9', 'TR'],
  // investing & crypto
  ['kraken', 'Kraken', '5741D9', 'K'],
  ['gemini', 'Gemini', '00DCFA', 'G'],
  ['wealthfront', 'Wealthfront', '4840BB', 'W'],
  ['public', 'Public', '000000', 'P'],
  ['interactivebrokers', 'Interactive Brokers', 'D81222', 'IB', ['ibkr']],
  ['tastytrade', 'tastytrade', 'E8283E', 'tt'],
  ['lendingclub', 'LendingClub', '0033A0', 'LC'],
  // shops & stores
  ['alibaba', 'Alibaba', 'FF6A00', 'Ali'],
  ['staples', 'Staples', 'CC0000', 'S'],
  ['officedepot', 'Office Depot', 'CC0000', 'OD'],
  ['kohls', "Kohl's", '000000', 'K', ['kohls']],
  ['nordstrom', 'Nordstrom', '1C1C1C', 'N'],
  ['sephora', 'Sephora', '000000', 'S'],
  ['ulta', 'Ulta Beauty', 'F26B1D', 'U'],
  ['wayfair', 'Wayfair', '7B189F', 'W'],
  ['temu', 'Temu', 'FB7701', 'T'],
  ['shein', 'SHEIN', '000000', 'S'],
  ['overstock', 'Overstock', 'D32F2F', 'O'],
  ['microcenter', 'Micro Center', 'E6392A', 'MC'],
  ['bhphoto', 'B&H Photo', '5A2D82', 'B&H', ['bhphotovideo']],
  ['kroger', 'Kroger', '0C4DA2', 'K'],
  ['albertsons', 'Albertsons', '0C5DA5', 'A'],
  ['safeway', 'Safeway', 'E31837', 'S'],
  ['publix', 'Publix', '3E7D32', 'P'],
  ['aldi', 'ALDI', '0A2C6B', 'ALDI'],
  ['traderjoes', "Trader Joe's", 'C8102E', 'TJ'],
  ['wholefoods', 'Whole Foods', '00674B', 'WF'],
  ['cvs', 'CVS', 'CC0000', 'CVS'],
  ['walgreens', 'Walgreens', 'E31837', 'W'],
  ['petco', 'Petco', '0056A4', 'P'],
  ['petsmart', 'PetSmart', '0057A8', 'PS'],
  ['chewy', 'Chewy', '1C49C2', 'C'],
  ['lululemon', 'lululemon', 'D31F26', 'L'],
  ['gap', 'Gap', '0C2B4E', 'GAP'],
  ['hm', 'H&M', 'E50010', 'H&M'],
  ['michaels', 'Michaels', 'ED1B2F', 'M'],
  ['joann', 'JOANN', '006B3F', 'J'],
  ['dollargeneral', 'Dollar General', 'FFD200', 'DG'],
  ['dollartree', 'Dollar Tree', '1F8F3B', 'DT'],
  ['tjmaxx', 'TJ Maxx', 'C8102E', 'TJX'],
  ['marshalls', 'Marshalls', '1D4C8F', 'M'],
  ['ross', 'Ross', 'AA0000', 'Ross'],
  ['basspro', 'Bass Pro Shops', '006838', 'BP'],
  ['rei', 'REI', '1C4F2E', 'REI'],
  ['dickssportinggoods', "Dick's Sporting Goods", '006B3F', 'DSG'],
  ['carmax', 'CarMax', 'FFCB05', 'CM'],
  ['carvana', 'Carvana', '00AEEF', 'C'],
  ['mercari', 'Mercari', 'FF0211', 'M'],
  ['poshmark', 'Poshmark', '7F0353', 'P'],
  ['depop', 'Depop', 'FF2300', 'd'],
  ['thredup', 'thredUP', '0D1F48', 'tU'],
  ['vinted', 'Vinted', '09B1BA', 'V'],
  ['offerup', 'OfferUp', '00AB80', 'O'],
  ['craigslist', 'craigslist', '5A2D82', 'CL'],
  ['realtor', 'Realtor.com', 'D92228', 'R'],
  ['redfin', 'Redfin', 'A02021', 'RF']
);

// What the whole library holds: every Simple Icons logo, plus the badges. `a` marks the ones used for the
// automatic logo (a login called "Netflix" or on netflix.com); the rest are found by searching in the picker, so
// an everyday word never gets a logo by accident.
const AUTO_MORE = `
xero gusto adp brex expensify zoho zendesk intercom hubspot twilio sendgrid webflow zapier airtable loom calendly
typeform surveymonkey qualtrics clickup basecamp bitbucket netlify supabase mongodb databricks tableau looker metabase
mixpanel hotjar googleanalytics semrush hootsuite buffer linktree carrd ghost cloudways kinsta wpengine porkbun
shopee newegg ikea autozone oreilly yelp thumbtack nextdoor fedex ups dhl usps aliexpress woocommerce bigcommerce
99designs shutterstock invoiceninja crunchbase indeed glassdoor upwork fiverr toptal gumroad kickstarter opensea
googlecloud sap vmware cisco dell hp lenovo samsung sony nvidia amd intel tesla ford toyota honda bmw mercedes volkswagen
`.trim().split(/\s+/);

const all = Object.values(si).filter((i) => i && i.slug);
const bySlug = new Map(all.map((i) => [i.slug, i]));
const autoSet = new Set([...SLUGS, ...AUTO_MORE]);
for (const slug of autoSet) if (!bySlug.has(slug)) console.warn('not in simple-icons:', slug);

const icons = all.map((i) => ({ id: i.slug, title: i.title, hex: i.hex, path: i.path, ...(autoSet.has(i.slug) ? { a: 1 } : {}) }));
const ids = new Set(icons.map((i) => i.id));
for (const [id, title, hex, text, alias] of BADGES) {
  if (ids.has(id)) continue; // a real logo already covers it
  ids.add(id);
  icons.push({ id, title, hex, text, ...(alias ? { alias } : {}), a: 1 });
}
icons.sort((a, b) => a.title.localeCompare(b.title));

const out = `// Generated by scripts/build-brand-icons.js from Simple Icons (CC0, https://simpleicons.org).
// Brand names and logos are trademarks of their respective owners.
window.BRAND_ICONS = ${JSON.stringify(icons)};
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'brand-icons.js'), out);
console.log(`wrote ${icons.length} brand icons (${Math.round(out.length / 1024)} KB), ${icons.filter((i) => i.a).length} for automatic matching`);
