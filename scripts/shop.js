// The Item Shop (pages/shop.html): what can be bought with site clicks and what it costs. Pure, so the shop page,
// the profile page, the header (scripts/site.js), the API (utils/shop.js) and the pretend API share it.
//   theme      the site's colors, only for the player who has it on (html[data-site-theme] in styles/stylesheet.css)
//   font       the player's name in another font, everywhere their name shows up
//   color      their name in another ink, with an outline the theme picks so it never blends into the page
//   highlight  a highlight behind their name
// Each kind has a free item everyone owns (DEFAULTS). Prices go in five tiers (TIERS), the same for every kind; name
// items go higher at the top end because everyone sees them. Lowering a price later is friendlier than raising one.
// Buying takes the price off the player's clicks (the leaderboard total), so the shop takes clicks out of the game.

export const KINDS = ['theme', 'font', 'color', 'highlight'];
export const KIND_NAMES = { theme: 'Website themes', font: 'Name fonts', color: 'Name colors', highlight: 'Name highlights' };

// Highest first. `at` is the lowest price in the tier.
export const TIERS = [
  { key: 'legendary', name: 'Legendary', at: 150000 },
  { key: 'epic', name: 'Epic', at: 50000 },
  { key: 'rare', name: 'Rare', at: 10000 },
  { key: 'common', name: 'Common', at: 2500 },
  { key: 'starter', name: 'Starter', at: 1 },
  { key: 'free', name: 'Free', at: 0 },
];
export const tierOf = (price) => TIERS.find((t) => price >= t.at);

// `swatch` is what the shop's card shows: a theme's page and accent colors, or a name item's look (the page draws a
// sample name with it). `dark` themes have light text on a dark page, with paper-colored cards on top.
export const ITEMS = [
  // Website themes (only you see them)
  { id: 'notebook', kind: 'theme', name: 'Notebook', price: 0, about: 'The classic: ruled notebook paper.', swatch: ['#fbf8f0', '#1f4fbf'] },
  { id: 'legal-pad', kind: 'theme', name: 'Legal Pad', price: 1000, about: 'Yellow legal paper with a red margin.', swatch: ['#fbf0b4', '#1f4fbf'] },
  { id: 'graph-paper', kind: 'theme', name: 'Graph Paper', price: 1000, about: 'A blue grid behind everything.', swatch: ['#f4f8fd', '#2a62c9'] },
  { id: 'kraft', kind: 'theme', name: 'Kraft Paper', price: 1000, about: 'A brown paper bag, written on in dark brown pen.', swatch: ['#dcbf94', '#5a3416'] },
  { id: 'chalkboard', kind: 'theme', name: 'Chalkboard', price: 2500, dark: true, about: 'Chalk on a green board, with the pages pinned on top. Easy on the eyes at night.', swatch: ['#28372f', '#f1efe6'] },
  { id: 'pasture', kind: 'theme', name: 'Pasture', price: 5000, about: 'Pale grass green with barn-red trim. Trusty’s home turf.', swatch: ['#e4f0cf', '#a3291f'] },
  { id: 'trusty-times', kind: 'theme', name: 'The Trusty Times', price: 7500, about: 'Grey newsprint and black serif headlines. Extra! Extra!', swatch: ['#ebeae3', '#161616'] },
  { id: 'blueprint', kind: 'theme', name: 'Blueprint', price: 10000, dark: true, about: 'White lines on blueprint blue, like Trusty’s plans for world domination.', swatch: ['#16407c', '#e9f2ff'] },
  { id: 'sunset', kind: 'theme', name: 'Sunset Sketchbook', price: 10000, about: 'Peach paper and plum ink, from a sketchbook left out at golden hour.', swatch: ['#fde2cf', '#8f2f62'] },
  { id: 'snow-day', kind: 'theme', name: 'Snow Day ❄️', price: 10000, about: 'White and ice blue, with snowflakes all down the margins. No school today.', swatch: ['#f2f8ff', '#2366a8'] },
  { id: 'tractor-crew', kind: 'theme', name: 'Da Tractor Crew', price: 15000, about: 'Tractor green and yellow with comic-panel borders, straight out of the comics.', swatch: ['#fff3b0', '#2b7a30'] },
  { id: 'hay-day', kind: 'theme', name: 'Hay Day', price: 25000, about: 'Straw and Slots-cabinet blue, from Trusty’s Hay Day.', swatch: ['#f6e3a3', '#2c45b0'] },
  // Late Night TV and High Roller have to be earned first (`needs`, GOALS below).
  { id: 'late-night-tv', kind: 'theme', name: 'Late Night TV', price: 50000, dark: true, needs: { goal: 'tv', at: 5 * 3600 }, about: 'Green phosphor glow and faint scanlines, for when Trusty TV is the only thing on.', swatch: ['#06170c', '#5dff8f'] },
  { id: 'golden-horse', kind: 'theme', name: 'Golden Horse 金馬', price: 75000, about: 'Red and gold for the Year of the Horse.', swatch: ['#fff0cf', '#b3121e'] },
  { id: 'high-roller', kind: 'theme', name: 'High Roller', price: 100000, dark: true, needs: { goal: 'casino', at: 50000 }, about: 'Casino-felt green with gold trim. The house knows your name.', swatch: ['#0d3b26', '#e6b94a'] },
  { id: 'neon', kind: 'theme', name: 'Midnight Neon', price: 150000, dark: true, about: 'Pink and cyan neon on a midnight sky.', swatch: ['#100b22', '#4df3ff'] },
  { id: 'pegasus', kind: 'theme', name: 'Pegasus', price: 300000, about: 'Cloud white and sky blue, with wings drawn in the margin. Trusty, but higher. The shop’s most expensive item.', swatch: ['#eef6ff', '#2463b0'] },

  // Name fonts. None of them downloads a new font: they're the site's own two, system fonts and Unicode letters.
  { id: 'standard', kind: 'font', name: 'Standard', price: 0, about: 'The site’s usual lettering.' },
  { id: 'typewriter', kind: 'font', name: 'Typewriter', price: 1000, about: 'Clack, clack, ding.' },
  { id: 'bubble', kind: 'font', name: 'Bubble Letters', price: 2500, about: 'Puffy outlined letters, like the back of a binder.' },
  { id: 'crayon', kind: 'font', name: 'Crayon', price: 5000, about: 'Waxy and a bit smudged.' },
  { id: 'calligraphy', kind: 'font', name: 'Calligraphy', price: 15000, about: 'Fancy pen, fancy horse.' },
  { id: 'blackletter', kind: 'font', name: 'Blackletter', price: 50000, about: 'Ye olde horse.' },
  { id: 'quill', kind: 'font', name: 'Quill', price: 150000, about: 'Your name writes itself in, a letter at a time.' },

  // Name colors. Pale ones (`outline`) get a thin outline in the theme's own ink so they never blend into the page.
  { id: 'ink', kind: 'color', name: 'Black Ink', price: 0, about: 'The usual.' },
  { id: 'red', kind: 'color', name: 'Red Ink', price: 500, about: 'Like a teacher’s pen.' },
  { id: 'blue', kind: 'color', name: 'Blue Ink', price: 500, about: 'Ballpoint blue.' },
  { id: 'green', kind: 'color', name: 'Green Ink', price: 500, about: 'Fresh grass.' },
  { id: 'hl-pink', kind: 'color', name: 'Highlighter Pink', price: 2500, outline: true, about: 'Hot pink, outlined so it pops.' },
  { id: 'hl-orange', kind: 'color', name: 'Highlighter Orange', price: 2500, outline: true, about: 'Traffic-cone orange.' },
  { id: 'hl-purple', kind: 'color', name: 'Highlighter Purple', price: 2500, outline: true, about: 'Grape soda purple.' },
  { id: 'two-tone', kind: 'color', name: 'Two-Tone Ink', price: 10000, about: 'The four-color pen, blue fading into red.' },
  { id: 'silver', kind: 'color', name: 'Silver', price: 25000, outline: true, about: 'Shiny metal letters.' },
  // Amber rather than bright gold, so it's never mistaken for the clicks board's #1 gold $.
  { id: 'gilded', kind: 'color', name: 'Gilded', price: 100000, outline: true, about: 'Old amber gold with a shine running through it.' },
  { id: 'rainbow', kind: 'color', name: 'Rainbow', price: 200000, about: 'Every marker in the pack, always moving.' },

  // Name highlights
  { id: 'none', kind: 'highlight', name: 'No Highlight', price: 0, about: 'Just your name.' },
  { id: 'yellow', kind: 'highlight', name: 'Yellow Highlighter', price: 1000, about: 'One swipe of the highlighter.' },
  { id: 'pastel-pink', kind: 'highlight', name: 'Pastel Pink', price: 2500, about: 'A soft pink swipe.' },
  { id: 'pastel-blue', kind: 'highlight', name: 'Pastel Blue', price: 2500, about: 'A soft blue swipe.' },
  { id: 'pastel-green', kind: 'highlight', name: 'Pastel Green', price: 2500, about: 'A soft green swipe.' },
  { id: 'pastel-lavender', kind: 'highlight', name: 'Pastel Lavender', price: 2500, about: 'A soft lavender swipe.' },
  { id: 'scribble', kind: 'highlight', name: 'Marker Scribble', price: 7500, about: 'Scribbled in behind your name.' },
  { id: 'washi', kind: 'highlight', name: 'Washi Tape', price: 20000, about: 'A strip of striped tape.' },
  { id: 'glow', kind: 'highlight', name: 'Glow', price: 60000, about: 'A warm glow all around.' },
  { id: 'sparkle', kind: 'highlight', name: 'Sparkle', price: 250000, about: 'Twinkling stars and a shimmer. The shop’s most expensive name item.' },
];

export const DEFAULTS = { theme: 'notebook', font: 'standard', color: 'ink', highlight: 'none' };

// Some items have to be earned before they can be bought (`needs: { goal, at }`): `at` of a goal, which goalsOf()
// works out from the account's click_game document. Goals only ever go up, so an unlocked item stays unlocked.
//   casino  clicks spent at the Casino: what every Blackjack, Craps, Slots and Poker bet lost, bet by bet (a bet
//           that paid back less than it cost counts the difference, and winning it back on another bet doesn't take
//           it off). The bank adds it up as it settles (`bank.lost.<game>` in utils/bank.js), from when that began.
//   tv      seconds of Trusty TV watched while it was paying clicks, every channel together (`tvSeconds.<channel>`,
//           api/clicks.js).
export const CASINO_GAMES = ['blackjack', 'craps', 'slots', 'poker'];
const fmtN = (n) => new Intl.NumberFormat('en-US').format(n);
export const GOALS = {
  casino: { href: '/pages/casino.html', go: 'To the Casino', say: (n) => `${fmtN(n)} clicks spent at the Casino` },
  tv: { href: '/pages/tv.html', go: 'Watch Trusty TV', say: (n) => `${fmtN(Math.floor(n / 360) / 10)} ${n === 3600 ? 'hour' : 'hours'} of Trusty TV` },
};
const counted = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

export function goalsOf(doc) {
  const lost = (doc && doc.bank && doc.bank.lost) || {};
  const watched = (doc && doc.tvSeconds && typeof doc.tvSeconds === 'object') ? doc.tvSeconds : {};
  return {
    casino: CASINO_GAMES.reduce((sum, game) => sum + counted(lost[game]), 0),
    tv: Object.values(watched).reduce((sum, n) => sum + counted(n), 0),
  };
}

// Whether an account with these goals (goalsOf()) may buy the item.
export const unlocked = (item, goals) => !item.needs || counted(goals && goals[item.needs.goal]) >= item.needs.at;
export const needText = (item) => (item.needs ? `Unlocks after ${GOALS[item.needs.goal].say(item.needs.at)}.` : '');

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));
export const itemById = (id) => (typeof id === 'string' && BY_ID.get(id)) || null;
export const itemsOf = (kind) => ITEMS.filter((item) => item.kind === kind);
export const isFree = (item) => Boolean(item) && item.price === 0;
export const isDarkTheme = (id) => Boolean(itemById(id) && itemById(id).kind === 'theme' && itemById(id).dark);

// The items an account bought (`shop.owned` on its click_game document), as a Set of real, paid item ids.
export function ownedSet(owned) {
  return new Set((Array.isArray(owned) ? owned : []).filter((id) => {
    const item = itemById(id);
    return item && !isFree(item);
  }));
}

export const owns = (owned, id) => {
  const item = itemById(id);
  return Boolean(item) && (isFree(item) || ownedSet(owned).has(id));
};

// What an account has on, from its `shop` ({ owned, equipped }): an item of each kind it owns, or the free one.
export function equippedOf(shop) {
  const owned = ownedSet(shop && shop.owned);
  const on = (shop && shop.equipped) || {};
  const out = {};
  for (const kind of KINDS) {
    const item = itemById(on[kind]);
    out[kind] = item && item.kind === kind && (isFree(item) || owned.has(item.id)) ? item.id : DEFAULTS[kind];
  }
  return out;
}

// The part everyone sees: how a name looks, leaving out the free defaults. null when it's all defaults.
export function nameStyleOf(shop) {
  const on = equippedOf(shop);
  const style = {};
  for (const kind of ['font', 'color', 'highlight']) if (on[kind] !== DEFAULTS[kind]) style[kind] = on[kind];
  return Object.keys(style).length ? style : null;
}

// A name style from anywhere (the API, localStorage), keeping only real items of the right kind.
export function cleanStyle(style) {
  if (!style || typeof style !== 'object') return null;
  const out = {};
  for (const kind of ['font', 'color', 'highlight']) {
    const item = itemById(style[kind]);
    if (item && item.kind === kind && item.id !== DEFAULTS[kind]) out[kind] = item.id;
  }
  return Object.keys(out).length ? out : null;
}

// A request to the shop: { do: 'buy', id } or { do: 'equip', id } (equipping a kind's free item takes the paid one
// off). null if it isn't one.
export function cleanOrder(body) {
  if (!body || typeof body !== 'object' || (body.do !== 'buy' && body.do !== 'equip')) return null;
  const item = itemById(body.id);
  if (!item) return null;
  if (body.do === 'buy' && isFree(item)) return null;
  return { do: body.do, item };
}

// Blackletter names are drawn in Unicode's bold Fraktur letters (𝕿𝖗𝖚𝖘𝖙𝖞), which every device has a font for.
// Only A–Z and a–z change; everything else stays as it is.
export function fraktur(text) {
  return Array.from(String(text), (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D56C + code - 65);
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D586 + code - 97);
    return ch;
  }).join('');
}
