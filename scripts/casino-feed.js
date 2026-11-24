// The lobby: how many people are on the site right now and the casino's big wins, live. Pure, shared by the
// click bank (utils/bank.js, which tells the lobby about a big win as it pays it), the lobby itself
// (realtime/lobby.js on Cloudflare, tools/local-rooms.mjs on the dev server), the pages (scripts/presence.js)
// and the tests.
//
// Messages from the lobby: { t: 'lobby', here, casino, wins } when you connect, { t: 'here', here, casino } when
// the counts change (a few seconds at most after someone comes or goes) and { t: 'win', wins } for new big
// wins. Pages send nothing but { t: 'ping' }.

export const LOBBY_PROTOCOL = 1;
// A win this many clicks over the bet goes in the feed (and every Grand Jackpot, whatever it was bet on).
export const BIG_WIN = 500;
export const FEED_SIZE = 10;
// How long the lobby waits to send new counts after someone comes or goes, so a page full of people arriving
// together is one message each, not one per arrival.
export const COUNT_EVERY = 3000;

export const GAMES = {
  blackjack: { name: 'Trusty Blackjack', href: '/pages/games/casino.html' },
  craps: { name: 'Trusty Craps', href: '/pages/games/craps.html' },
  slots: { name: 'Trusty Slots', href: '/pages/games/slots.html' },
  poker: { name: 'Trusty Poker', href: '/pages/games/poker.html' },
  fever: { name: 'Trusty Fever', href: '/pages/games/fever.html' },
};

// The pages that count as the casino: its own page and its four games.
const CASINO_PAGES = ['/pages/casino.html', '/pages/games/casino.html', '/pages/games/craps.html', '/pages/games/slots.html', '/pages/games/poker.html'];
export const areaOf = (pathname) => (CASINO_PAGES.includes(pathname) ? 'casino' : 'site');

const MAX_WON = 1e7;
const NAME = /^[^\p{C}]{1,40}$/u;

/** The feed's entry for a bet that was just paid `payout` on `amount`, or null if it isn't a big win. */
export function bigWin({ name, game, amount, payout, windfall = 0 }, now = Date.now()) {
  const won = payout - amount;
  const jackpot = game === 'slots' && windfall > 0;
  if (!(won >= BIG_WIN) && !jackpot) return null;
  return cleanWin({ name, game, won, jackpot, at: now });
}

/** A win as the lobby keeps it, or null if it isn't one (the lobby checks everything it's sent). */
export function cleanWin(win) {
  if (!win || typeof win !== 'object') return null;
  const { name, game, won, jackpot = false, at } = win;
  if (typeof name !== 'string' || !NAME.test(name) || !Object.hasOwn(GAMES, game)) return null;
  if (!Number.isSafeInteger(won) || won < 1 || won > MAX_WON || typeof jackpot !== 'boolean') return null;
  if (!Number.isSafeInteger(at) || at < 0) return null;
  return { name, game, won, jackpot, at };
}

/** The feed with `wins` added: newest first, FEED_SIZE at most. */
export function addWins(feed, wins) {
  const fresh = wins.map(cleanWin).filter(Boolean);
  return [...fresh, ...feed].sort((a, b) => b.at - a.at).slice(0, FEED_SIZE);
}

/** The counts message, from the area of every open connection. */
export function counts(areas) {
  return { t: 'here', here: areas.length, casino: areas.filter((a) => a === 'casino').length };
}

/** "2 minutes ago", for a feed entry. */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
