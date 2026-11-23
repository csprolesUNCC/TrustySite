// The Daily Games board's rules (pages/daily.html), with no DOM: reading the share text other sites' daily
// games copy (Wordle, Connections, Krillion, RNGdle), checking it makes sense, ranking results, flagging ones that look
// too good, and working out a player's stats. Trustle is on the board too, but its results come from the games
// the site already keeps (api/trustle-api.js), not from pasted text. Shared by the page (to preview a paste), utils/daily.js
// (which decides what's saved), the pretend API and the tests.
//
// None of these sites let anyone check a score, so this is the honor system: all the checks here can do is turn
// away share text that's broken or made up badly (a grid that doesn't match the score, a puzzle that isn't on
// today) and point out results that are hard to believe (flagsFor). Nothing here pays clicks, and it mustn't:
// anyone can type a perfect grid.

import { dayOf, dayBefore } from './milestones.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const dayFrom = (number) => new Date(number * DAY_MS).toISOString().slice(0, 10);
export const dayAfter = (day) => dayFrom(dayNumber(day) + 1);
export const isDay = (day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && dayFrom(dayNumber(day)) === day;

// The other sites' games, in the order the board shows them (after Trustle). `first` is the day of puzzle
// `start`, so a puzzle's number gives its day. RNGdle's share has no number or date, so it has no `first`: a
// roll counts for the day it's posted.
export const GAMES = {
  wordle: { name: 'Wordle', site: 'NYT Games', url: 'https://www.nytimes.com/games/wordle/index.html', first: '2021-06-19', start: 0 },
  connections: { name: 'Connections', site: 'NYT Games', url: 'https://www.nytimes.com/games/connections', first: '2023-06-12', start: 1 },
  krillion: { name: 'Krillion', site: 'krillion.io', url: 'https://krillion.io', first: '2026-07-16', start: 1 },
  rngdle: { name: 'RNGdle', site: 'rngdle.com', url: 'https://rngdle.com' },
};
export const GAME_KEYS = Object.keys(GAMES);
// Every board on the page, Trustle first.
export const BOARD_KEYS = ['trustle', ...GAME_KEYS];
export const BOARD_NAMES = { trustle: 'Trustle', ...Object.fromEntries(GAME_KEYS.map((key) => [key, GAMES[key].name])) };

export const MAX_TEXT = 2000;

/** The day puzzle `n` of `game` was out (null for a game without numbers). */
export function dayOfPuzzle(game, n) {
  const g = GAMES[game];
  return g && g.first ? dayFrom(dayNumber(g.first) + (n - g.start)) : null;
}

/** The number of `game`'s puzzle on `day` (null for a game without numbers). */
export function puzzleOn(game, day) {
  const g = GAMES[game];
  return g && g.first ? dayNumber(day) - dayNumber(g.first) + g.start : null;
}

/**
 * The days a score can be posted for: yesterday, today or tomorrow (Eastern). Each site's puzzle changes at the
 * player's own midnight, so someone far east or west of New York can be a day off from the site's day. Older puzzles don't count: the board is for playing along.
 */
export function postableDays(today = dayOf()) {
  return [dayBefore(today), today, dayAfter(today)];
}

/* ---------- Reading share text ---------- */

// Emoji share grids sometimes carry variation selectors (U+FE0F) or zero-width joiners; they mean nothing here.
const clean = (text) => text.replace(/[️‍\r]/g, '');
const tilesOf = (line, tiles) => {
  const chars = [...line.replace(/\s/g, '')];
  return chars.length && chars.every((c) => tiles[c]) ? chars.map((c) => tiles[c]).join('') : null;
};
const gridOf = (text, tiles) => text.split('\n').map((line) => tilesOf(line, tiles)).filter(Boolean);
const numberIn = (s) => Number(String(s).replace(/[\s,.  ]/g, ''));

// c: right letter, right spot; p: in the word; a: not in it. High-contrast mode uses orange and blue.
const WORDLE_TILES = { '🟩': 'c', '🟧': 'c', '🟨': 'p', '🟦': 'p', '⬛': 'a', '⬜': 'a' };
// One letter for each group's color: yellow, green, blue, purple.
const CONNECTIONS_TILES = { '🟨': 'y', '🟩': 'g', '🟦': 'b', '🟪': 'p' };
// Krillion's rarity tiers, from the commonest answer to the rarest, and a miss. One emoji per prompt.
export const KRILLION = {
  prompts: 7,
  tiers: [
    { tile: 'm', emoji: '⬛', name: 'Miss', points: 0 },
    { tile: '1', emoji: '🫧', name: 'Plankton', points: 10 },
    { tile: '2', emoji: '🤡', name: 'Too Clever', points: 15 },
    { tile: '3', emoji: '🐟', name: 'Schooler', points: 30 },
    { tile: '4', emoji: '🦑', name: 'Rare', points: 60 },
    { tile: '5', emoji: '🏮', name: 'Deep Cut', points: 85 },
    { tile: '6', emoji: '🌟', name: 'One in a Krillion', points: 100 },
  ],
};
KRILLION.max = KRILLION.prompts * Math.max(...KRILLION.tiers.map((t) => t.points));
const KRILLION_TILES = Object.fromEntries(KRILLION.tiers.map((t) => [t.emoji, t.tile]));
const KRILLION_RUN = new RegExp(`(?:[${KRILLION.tiers.map((t) => t.emoji).join('')}]\\s*)+`, 'gu');
const KRILLION_POINTS = Object.fromEntries(KRILLION.tiers.map((t) => [t.tile, t.points]));
export const krillionScore = (row) => [...row].reduce((sum, tile) => sum + KRILLION_POINTS[tile], 0);

function readWordle(text) {
  const head = /\bWordle\s+#?\s*(\d[\d,.\s  ]{0,8}?)\s+([1-6X])\s*\/\s*6(\*?)/i.exec(text);
  if (!head) return null;
  const n = numberIn(head[1]);
  const guesses = head[2].toUpperCase() === 'X' ? null : Number(head[2]);
  const grid = gridOf(text.slice(head.index + head[0].length), WORDLE_TILES).filter((row) => row.length === 5);
  if (!grid.length) return { error: 'Paste the whole thing, grid and all, not just the first line.' };
  const solved = (row) => row === 'ccccc';
  const ok = guesses
    ? grid.length === guesses && solved(grid[grid.length - 1]) && !grid.slice(0, -1).some(solved)
    : grid.length === 6 && !grid.some(solved);
  if (!ok) return { error: 'That grid doesn’t match the score above it.' };
  return { game: 'wordle', n, result: { guesses, hard: head[3] === '*', grid } };
}

function readConnections(text) {
  const head = /\bConnections\b[\s\S]{0,40}?Puzzle\s*#\s*(\d[\d,.\s  ]{0,8}?)(?=\s|$)/i.exec(text);
  if (!head) return null;
  const n = numberIn(head[1]);
  const grid = gridOf(text.slice(head.index + head[0].length), CONNECTIONS_TILES).filter((row) => row.length === 4);
  if (!grid.length) return { error: 'Paste the whole thing, grid and all, not just the first lines.' };
  const found = grid.filter((row) => new Set(row).size === 1);
  const mistakes = grid.length - found.length;
  const won = found.length === 4;
  const ok = new Set(found.map((row) => row[0])).size === found.length && grid.length <= 7
    // A game ends on the fourth group found, or on the fourth mistake.
    && (won ? mistakes <= 3 && new Set(grid[grid.length - 1]).size === 1 : mistakes === 4 && new Set(grid[grid.length - 1]).size > 1);
  if (!ok) return { error: 'That grid isn’t a game of Connections that could happen.' };
  return { game: 'connections', n, result: { won, mistakes, found: found.length, grid } };
}

// "Krillion #130 🦐", the score on a line of its own, a blank line, then a row of one emoji per prompt. The score comes from the row itself, so a
// score line that says something else means the text was changed.
function readKrillion(text) {
  const head = /\bKrillion\s*#\s*(\d[\d,.\u00a0\u202f]{0,6})/i.exec(text);
  if (!head) return null;
  const n = numberIn(head[1]);
  const rest = text.slice(head.index + head[0].length);
  // The row can share a line with other words, so take the longest run of tier emoji.
  const runs = rest.match(KRILLION_RUN) || [];
  if (!runs.length) return { error: 'Paste the whole thing, emoji and all.' };
  const longest = runs.reduce((a, b) => ([...a.replace(/\s/g, '')].length >= [...b.replace(/\s/g, '')].length ? a : b));
  const row = tilesOf(longest, KRILLION_TILES);
  if (runs.length > 1 || [...row].length !== KRILLION.prompts) return { error: `A Krillion dive has ${KRILLION.prompts} prompts, so the row needs ${KRILLION.prompts} emoji.` };
  const score = krillionScore(row);
  // Only numbers that clearly are the score are checked: the game's own share puts it alone on the line under
  // the header ("245"); "450/700", "450 pts" and "4,500m" deep (10m a point) count too. A line like "Top 12%"
  // never gets in the way.
  const said = [
    ...[...rest.matchAll(/^\s*(\d{1,3})\s*$/gm)].map((m) => Number(m[1])),
    ...[...rest.matchAll(/(\d[\d,]{0,5})\s*(\/\s*700|pts\b|points\b|m\b)/gi)]
      .map((m) => (m[2].toLowerCase() === 'm' ? numberIn(m[1]) / 10 : numberIn(m[1]))),
  ];
  if (said.length && !said.includes(score)) return { error: 'That score doesn’t match the emoji under it.' };
  return { game: 'krillion', n, result: { score, grid: [row] } };
}

// RNGdle: one random roll a day from 0 to 1,000,000, scored in EP for the patterns in it. Its share is
//   RNGdle 🎲 805393
//   ⬜ COMMON • Bottom 7.5%
//   ⬜ 🏞️ Hills            (a line per badge, the first few)
//   +8 more
//   2,831 EP
// with no puzzle number or date, so a roll counts for the day it's posted, and nothing can tell today's roll
// from an old one. The EP can't be checked against the roll either (the scoring is the site's own).
export const RNGDLE = { maxRoll: 1000000, maxEp: 10000000, rare: 0.1 };
const RNGDLE_TIER = /^[^\S\n]*\S*[^\S\n]*([A-Z][A-Z ]{1,19}?)[^\S\n]*[•·|-][^\S\n]*(Top|Bottom)[^\S\n]+(\d{1,3}(?:\.\d+)?)\s*%[^\S\n]*$/m;

function readRngdle(text, today) {
  const head = /\bRNGdle\b[^\d\n]*(\d[\d,]{0,8})/i.exec(text);
  if (!head) return null;
  const rest = text.slice(head.index + head[0].length);
  const roll = numberIn(head[1]);
  const ep = /(\d[\d,]{0,9})\s*EP\b/.exec(rest);
  const tier = RNGDLE_TIER.exec(rest);
  if (!ep || !tier) return { error: 'Paste the whole thing: it needs the rarity line and your EP.' };
  const pct = Number(tier[3]);
  const points = numberIn(ep[1]);
  if (!Number.isSafeInteger(roll) || roll > RNGDLE.maxRoll || points > RNGDLE.maxEp || pct > 100) {
    return { error: 'Those numbers don’t look like an RNGdle roll.' };
  }
  // The badges: a line each between the rarity line and the EP, plus "+8 more".
  const between = rest.slice(tier.index + tier[0].length, ep.index).split('\n').map((l) => l.trim()).filter(Boolean);
  const more = between.map((l) => /^\+\s*(\d{1,3})\s+more$/i.exec(l)).find(Boolean);
  const badges = between.filter((l) => !/^\+/.test(l) && !/^https?:/i.test(l)).length + (more ? Number(more[1]) : 0);
  return { game: 'rngdle', n: null, day: today, result: { roll, ep: points, tier: tier[1].trim(), side: tier[2], pct, badges } };
}

/**
 * Reads one game's share text.
 * @param {unknown} text - What the player pasted.
 * @param {string} [today] - Eastern day ('YYYY-MM-DD'), for which puzzles can still be posted.
 * @returns {{ game, n, day, result } | { error: string }}
 */
export function parseShare(text, today = dayOf()) {
  if (typeof text !== 'string' || !text.trim()) return { error: 'Paste the share text from a game first.' };
  if (text.length > MAX_TEXT) return { error: 'That’s too much text. Paste one game at a time.' };
  const t = clean(text);
  const read = readWordle(t) || readConnections(t) || readKrillion(t) || readRngdle(t, today);
  if (!read) return { error: 'That doesn’t look like share text from Wordle, Connections, Krillion or RNGdle.' };
  if (read.error) return read;
  const day = read.day || (Number.isSafeInteger(read.n) && read.n >= GAMES[read.game].start ? dayOfPuzzle(read.game, read.n) : null);
  if (!day) return { error: 'That puzzle number doesn’t look right.' };
  if (!postableDays(today).includes(day)) {
    return { error: `That’s not today’s ${GAMES[read.game].name}. Only today’s puzzle (or yesterday’s) can go on the board.` };
  }
  return { game: read.game, n: read.n, day, result: read.result };
}

/* ---------- Ranking and showing results ---------- */

/** A number to sort a result by on its game's board: lower is better. */
export function rankOf(game, result) {
  switch (game) {
    case 'wordle': return result.guesses || 7;
    case 'connections': return result.won ? result.mistakes : 10 - result.found; // every win beats every loss
    case 'krillion': return KRILLION.max - result.score; // the higher score, the better
    case 'rngdle': return -result.ep; // the more EP, the better
    case 'trustle': return result.won ? result.tries : 7;
    default: return Infinity;
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How a result reads on the board: '3/6', 'Perfect', '450'... */
export function describe(game, result) {
  switch (game) {
    case 'wordle': return `${result.guesses || 'X'}/6${result.hard ? '*' : ''}`;
    case 'trustle': return result.won ? `${result.tries}/6` : 'X/6';
    case 'connections':
      if (!result.won) return `Lost (${result.found}/4)`;
      return result.mistakes ? plural(result.mistakes, 'mistake') : 'Perfect';
    case 'krillion': return `${result.score}/${KRILLION.max}`;
    case 'rngdle': return `${result.ep.toLocaleString('en-US')} EP`;
    default: return '';
  }
}

const titleCase = (words) => words.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** A line under the name for a game with no grid to show (RNGdle's roll), or null. */
export function detail(game, result) {
  if (game !== 'rngdle') return null;
  return [`🎲 ${result.roll.toLocaleString('en-US')}`, titleCase(result.tier), `${result.side}\u00a0${result.pct}%`, plural(result.badges, 'badge')].join(' · ');
}

// The emoji the share text used, for showing a grid again.
export const EMOJI = {
  wordle: { c: '🟩', p: '🟨', a: '⬜' },
  trustle: { c: '🟩', p: '🟨', a: '⬜' },
  connections: { y: '🟨', g: '🟩', b: '🟦', p: '🟪' },
  krillion: Object.fromEntries(KRILLION.tiers.map((t) => [t.tile, t.emoji])),
};

/**
 * Competition ranking ("1, 2, 2, 4") for a board's entries, already sorted best first.
 * @param {{ rank: number }[]} entries
 * @returns {number[]}
 */
export function places(entries) {
  return entries.map((entry, i) => {
    let first = i;
    while (first > 0 && entries[first - 1].rank === entry.rank) first -= 1;
    return first + 1;
  });
}

/* ---------- Flags ---------- */

// Results that are possible but hard to believe, alone or over a run of games. A flag doesn't stop a score
// going up: it shows "Sus?" next to it on the board and lists it in the admin panel, where an admin can take it
// down or say it looks fine.
export const FLAG_RULES = {
  wordleInOne: 'Got Wordle in one guess',
  wordleAverage: { games: 10, last: 20, below: 3, text: 'Averaging under 3 guesses at Wordle' },
  connectionsPerfect: { games: 15, text: '15 perfect Connections in a row' },
  krillionPerfect: `A perfect ${KRILLION.max} at Krillion`,
  krillionAverage: { games: 10, last: 20, above: 600, text: 'Averaging over 600 at Krillion' },
  // Every RNGdle roll is luck, so only one the site itself calls a 1-in-1,000 is worth a look.
  rngdleRare: `A top ${RNGDLE.rare}% RNGdle roll`,
};

/**
 * @param {string} game
 * @param {object} result - The new result.
 * @param {object[]} history - The player's earlier results at this game, newest first.
 * @returns {string[]} Why it looks too good, if it does.
 */
export function flagsFor(game, result, history = []) {
  const flags = [];
  const recent = (count) => [result, ...history].slice(0, count);
  const average = (list, value) => list.reduce((sum, r) => sum + value(r), 0) / list.length;
  if (game === 'wordle') {
    if (result.guesses === 1) flags.push(FLAG_RULES.wordleInOne);
    const { games, last, below, text } = FLAG_RULES.wordleAverage;
    const list = recent(last);
    if (list.length >= games && average(list, (r) => r.guesses || 7) < below) flags.push(text);
  }
  if (game === 'connections') {
    const { games, text } = FLAG_RULES.connectionsPerfect;
    const list = recent(games);
    if (list.length === games && list.every((r) => r.won && r.mistakes === 0)) flags.push(text);
  }
  if (game === 'krillion') {
    if (result.score === KRILLION.max) flags.push(FLAG_RULES.krillionPerfect);
    const { games, last, above, text } = FLAG_RULES.krillionAverage;
    const list = recent(last);
    if (list.length >= games && average(list, (r) => r.score) > above) flags.push(text);
  }
  if (game === 'rngdle' && result.side === 'Top' && result.pct <= RNGDLE.rare) flags.push(FLAG_RULES.rngdleRare);
  return flags;
}

/* ---------- Stats ---------- */

/**
 * A player's stats at one game, for their profile.
 * @param {string} game
 * @param {{ day: string, result: object }[]} entries - Their results at it, any order.
 * @param {string} [today]
 * @returns {{ played, streak, best, won?, average?, perfect? }}
 */
export function statsFor(game, entries, today = dayOf()) {
  const days = new Set(entries.map((e) => e.day));
  // Days in a row with a result, ending today (or yesterday, if today's isn't in yet).
  let day = days.has(today) ? today : dayBefore(today);
  let streak = 0;
  while (days.has(day)) { streak += 1; day = dayBefore(day); }
  const results = entries.map((e) => e.result);
  const stats = { played: entries.length, streak };
  const mean = (values) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
  if (game === 'wordle') {
    const wins = results.filter((r) => r.guesses);
    Object.assign(stats, { won: wins.length, average: mean(wins.map((r) => r.guesses)), best: wins.length ? Math.min(...wins.map((r) => r.guesses)) : null });
  }
  if (game === 'connections') {
    Object.assign(stats, { won: results.filter((r) => r.won).length, perfect: results.filter((r) => r.won && !r.mistakes).length });
  }
  if (game === 'krillion') {
    const scores = results.map((r) => r.score);
    Object.assign(stats, { average: scores.length ? Math.round(mean(scores)) : null, best: scores.length ? Math.max(...scores) : null });
  }
  if (game === 'rngdle') {
    const eps = results.map((r) => r.ep);
    Object.assign(stats, { average: eps.length ? Math.round(mean(eps)) : null, best: eps.length ? Math.max(...eps) : null });
  }
  return stats;
}

/* ---------- Checking stored results ---------- */

/**
 * A safe copy of a result read back from the database (or from the pretend API), or null.
 * The server only ever saves what parseShare() made, but nothing is drawn from data that wasn't checked.
 */
export function cleanResult(game, result) {
  if (!result || typeof result !== 'object') return null;
  const rows = (pattern, max) => (Array.isArray(result.grid) && result.grid.length <= max && result.grid.every((r) => typeof r === 'string' && pattern.test(r)) ? [...result.grid] : null);
  const whole = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  if (game === 'wordle' || game === 'trustle') {
    const grid = rows(game === 'wordle' ? /^[cpa]{5}$/ : /^[cpa]{3,9}$/, 6);
    if (!grid) return null;
    if (game === 'trustle') return typeof result.won === 'boolean' && whole(result.tries, 1, 6) ? { won: result.won, tries: result.tries, grid } : null;
    if (result.guesses !== null && !whole(result.guesses, 1, 6)) return null;
    return { guesses: result.guesses, hard: result.hard === true, grid };
  }
  if (game === 'connections') {
    const grid = rows(/^[ygbp]{4}$/, 7);
    if (!grid || typeof result.won !== 'boolean' || !whole(result.mistakes, 0, 4) || !whole(result.found, 0, 4)) return null;
    return { won: result.won, mistakes: result.mistakes, found: result.found, grid };
  }
  if (game === 'krillion') {
    const grid = rows(new RegExp(`^[${KRILLION.tiers.map((t) => t.tile).join('')}]{${KRILLION.prompts}}$`), 1);
    return grid && grid.length === 1 && result.score === krillionScore(grid[0]) ? { score: result.score, grid } : null;
  }
  if (game === 'rngdle') {
    const { roll, ep, tier, side, pct, badges } = result;
    if (!whole(roll, 0, RNGDLE.maxRoll) || !whole(ep, 0, RNGDLE.maxEp) || !whole(badges, 0, 999)) return null;
    if (typeof tier !== 'string' || !/^[A-Z][A-Z ]{1,19}$/.test(tier) || (side !== 'Top' && side !== 'Bottom')) return null;
    if (typeof pct !== 'number' || !(pct >= 0 && pct <= 100)) return null;
    return { roll, ep, tier, side, pct, badges };
  }
  return null;
}
