// Notifications: the mail button in the header (scripts/site.js) and what it says. Pure, shared by the header, the
// API (utils/notifications.js) and the pretend API (tools/dev-server.mjs).
//
// A notification is plain data, never text written on the server, so the header words it:
//   { kind: 'payment', from, amount, note }   someone sent you clicks on HayPay (utils/transfer.js)
//   { kind: 'weekly', game, week, place, prize } you won a place on a weekly board (utils/weekly.js)
//   { kind: 'passed', game, by, rank }         someone passed you on a board's top 10: `rank` is where you are now,
//                                              past BOARD_TOP when it knocked you off the board
// plus `id`, `at` (ISO time) and `read`.

export const NOTES = Object.freeze({
  shown: 30, // the newest this many are listed
  keepDays: 60, // and every one is deleted this long after it was sent (a TTL index in utils/db.js)
  pollMs: 3 * 60 * 1000, // the header asks again this often while the tab is looked at
});

// Who counts as passed: the players on the top BOARD_TOP of a board (the boards show 10).
export const BOARD_TOP = 10;

export const BOARD_LABELS = Object.freeze({
  flappy: 'Flappy Trusty',
  draw: 'Draw Trusty',
  trustis: 'Trustis',
  snake: 'Trusty Snake',
});

const KINDS = new Set(['payment', 'weekly', 'passed']);

/**
 * The players a new best of `score` by `userId` passes on a board, from that board's top BOARD_TOP as it was just
 * before the score saved (sorted best first, ties to the earlier score). Everyone above the player's old place
 * with a lower score is passed, and moves down one: `rank` is their place now.
 * @param {{ userId: string, name: string, score: number }[]} top
 * @param {string} userId
 * @param {number} score
 */
export function passedOn(top, userId, score) {
  if (!Array.isArray(top)) return [];
  const mine = top.findIndex((e) => e && e.userId === userId);
  const above = mine === -1 ? top : top.slice(0, mine);
  const passed = [];
  above.forEach((e, i) => {
    // A tie stays ahead: the earlier score ranks first.
    if (e && typeof e.userId === 'string' && e.userId !== userId && e.score < score) {
      passed.push({ userId: e.userId, name: e.name, rank: i + 2 });
    }
  });
  return passed;
}

const isName = (s) => typeof s === 'string' && s.length > 0 && s.length <= 64;
const isCount = (n) => Number.isSafeInteger(n) && n > 0;

/**
 * One notification as the API sent it, checked, or null.
 */
export function cleanNote(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.has(raw.kind)) return null;
  const base = {
    id: typeof raw.id === 'string' ? raw.id : '',
    kind: raw.kind,
    at: typeof raw.at === 'string' && !Number.isNaN(Date.parse(raw.at)) ? raw.at : null,
    read: raw.read === true,
  };
  if (raw.kind === 'payment') {
    if (!isName(raw.from) || !isCount(raw.amount)) return null;
    return { ...base, from: raw.from, amount: raw.amount, note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : '' };
  }
  if (!Object.hasOwn(BOARD_LABELS, raw.game)) return null;
  if (raw.kind === 'weekly') {
    if (!isCount(raw.place) || !isCount(raw.prize)) return null;
    return { ...base, game: raw.game, week: typeof raw.week === 'string' ? raw.week : '', place: raw.place, prize: raw.prize };
  }
  if (!isName(raw.by) || !isCount(raw.rank)) return null;
  return { ...base, game: raw.game, by: raw.by, rank: raw.rank };
}

export const ordinal = (n) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};

/**
 * Where a notification's link goes.
 */
export function noteHref(note) {
  if (note.kind === 'payment') return '/pages/profile.html#haypay';
  if (note.kind === 'weekly') return '/pages/leaderboard.html#weekly';
  return `/pages/leaderboard.html#${note.game}`;
}

/**
 * "5m ago" and so on, for the list.
 */
export function agoLine(at, now = Date.now()) {
  const ms = now - Date.parse(at);
  if (!(ms >= 0)) return 'just now';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}
