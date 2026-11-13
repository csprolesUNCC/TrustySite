// Trusty's casino winnings: the house's net, everything players have lost betting clicks minus everything they've
// won, at every game the click bank keeps stats for (utils/bank.js: `bank.stats.<game>.<month>` on each player's
// `click_game` document, the net of every settled bet). Shown as his click total on his profile (the account
// named HOUSE_NAME, utils/profile.js); it's only ever a number on show, never clicks anyone can spend. Worked out
// from the same records the profiles use, so it goes back to the casino's first bet and can't drift from what
// players actually lost. Fever pots are player against player, so they only add the odd click a split pot can't
// share out.

export const HOUSE_NAME = 'Trusty';
export const isHouse = (name) => typeof name === 'string' && name.toLowerCase() === HOUSE_NAME.toLowerCase();

const CACHE_MS = 60 * 1000;
let cached = null; // { at, value }

// Adds up every player's betting stats: { total, games: { [game]: net } }, the house's side of them.
export async function houseWinnings(col, now = Date.now()) {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const docs = await col.find({ 'bank.stats': { $exists: true } }, { projection: { _id: 0, 'bank.stats': 1 } }).toArray();
  const games = {};
  for (const doc of docs) {
    for (const [game, months] of Object.entries(doc.bank.stats || {})) {
      for (const n of Object.values(months || {})) {
        if (Number.isFinite(n)) games[game] = (games[game] || 0) - n;
      }
    }
  }
  const value = { total: Object.values(games).reduce((a, b) => a + b, 0), games };
  cached = { at: now, value };
  return value;
}

// For the tests.
export function forgetHouse() {
  cached = null;
}
