// Trustle's rules, with no DOM: which word is today's, and how a guess scores. Used by pages/games/trustle.html.
//
// A new puzzle starts every day at midnight Eastern time, the same moment for everyone, so everybody is
// always on the same word. Puzzle #1 is FIRST_DAY; after the last word in the list, it starts over in a
// shuffled order that's the same for everyone.

import { FIRST_DAY, WORDS } from './trustle-words.js';

export const ZONE = 'America/New_York';
export const MAX_GUESSES = 6;

const DAY = 24 * 60 * 60 * 1000;
const FIRST = Date.parse(`${FIRST_DAY}T00:00:00Z`);

const wallFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

// The time on a clock in ZONE at the instant `ms`, written as if it were a UTC time.
function wallClock(ms) {
  const p = {};
  for (const { type, value } of wallFormat.formatToParts(ms)) p[type] = Number(value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

export function puzzleNumber(ms = Date.now()) {
  return Math.max(1, Math.floor((wallClock(ms) - FIRST) / DAY) + 1);
}

// The instant puzzle `n` goes live: midnight in ZONE. The zone's offset is checked at that moment itself,
// so days when the clocks change still come out right.
export function puzzleStart(n) {
  const midnight = FIRST + (n - 1) * DAY;
  const offsetAt = (ms) => wallClock(ms) - Math.floor(ms / 1000) * 1000;
  return midnight - offsetAt(midnight - offsetAt(midnight));
}

// Small seeded random numbers (mulberry32), so a shuffle comes out the same on every device.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The order of the list's `run`th time through: as written the first time, shuffled after that. A run
// never starts with the word the one before it ended on, so no word comes up two days in a row.
function runOrder(run) {
  const order = WORDS.map((_, i) => i);
  if (run === 0) return order;
  const next = random(run * 7919 + 21);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const lastTime = runOrder(run - 1);
  if (order.length > 1 && order[0] === lastTime[lastTime.length - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

// { word, see? } for puzzle `n`.
export function puzzleWord(n) {
  const i = Math.max(0, n - 1);
  const run = Math.floor(i / WORDS.length);
  return WORDS[runOrder(run)[i % WORDS.length]];
}

// Scores a guess like Wordle: 'correct' (right letter, right spot), 'present' (in the word, somewhere else)
// or 'absent'. A letter only lights up as many times as it's in the answer, right spots first.
export function grade(guess, answer) {
  const result = Array(answer.length).fill('absent');
  const left = {};
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) result[i] = 'correct';
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < answer.length; i++) {
    if (result[i] !== 'correct' && left[guess[i]] > 0) {
      result[i] = 'present';
      left[guess[i]] -= 1;
    }
  }
  return result;
}

const RANK = { absent: 1, present: 2, correct: 3 };

// The best thing each letter has shown so far, for colouring the keyboard: { A: 'correct', ... }.
export function letterStates(guesses, answer) {
  const states = {};
  for (const guess of guesses) {
    grade(guess, answer).forEach((state, i) => {
      const letter = guess[i];
      if (!states[letter] || RANK[state] > RANK[states[letter]]) states[letter] = state;
    });
  }
  return states;
}

/* ---------- Game history (shared by the page and api/trustle-api.js) ---------- */

// A player's history is { [puzzle number]: game }. A game is { guesses: ['HORSE', ...] }.
// Days played before history was kept are { legacy: true, won, tries }, rebuilt from the old stats.

// A safe copy of one game for puzzle `n`, or null if it doesn't make sense.
export function cleanGame(n, game) {
  if (!Number.isInteger(n) || n < 1 || !game || typeof game !== 'object') return null;
  if (game.legacy === true) {
    const tries = Number(game.tries);
    if (game.won === true && Number.isInteger(tries) && tries >= 1 && tries <= MAX_GUESSES) return { legacy: true, won: true, tries };
    if (game.won === false) return { legacy: true, won: false, tries: MAX_GUESSES };
    return null;
  }
  if (!Array.isArray(game.guesses) || game.guesses.length > MAX_GUESSES) return null;
  const answer = puzzleWord(n).word;
  const pattern = new RegExp(`^[A-Z]{${answer.length}}$`);
  if (!game.guesses.every((g) => typeof g === 'string' && pattern.test(g))) return null;
  const hit = game.guesses.indexOf(answer);
  if (hit >= 0 && hit < game.guesses.length - 1) return null; // nothing comes after the answer
  return { guesses: [...game.guesses] };
}

// { done, won, tries } for a game of puzzle `n`.
export function outcome(n, game) {
  if (game.legacy) return { done: true, won: game.won, tries: game.tries };
  const won = game.guesses[game.guesses.length - 1] === puzzleWord(n).word;
  return { done: won || game.guesses.length >= MAX_GUESSES, won, tries: game.guesses.length };
}

// The same puzzle played on two devices: real games beat rebuilt ones, and a game that carries on from
// the other one wins. If they really differ, the one already kept (`a`) stays.
export function mergeGame(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.legacy || b.legacy) return a.legacy && !b.legacy ? b : a;
  const [short, long] = a.guesses.length <= b.guesses.length ? [a, b] : [b, a];
  const carriesOn = short.guesses.every((g, i) => g === long.guesses[i]);
  return { guesses: [...(carriesOn ? long : a).guesses] };
}

export function mergeHistory(a, b) {
  const out = { ...a };
  for (const [key, game] of Object.entries(b)) out[key] = mergeGame(out[key], game);
  return out;
}

export const sameGame = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Played, won, guess counts and streaks, worked out from the history. `today` is today's puzzle number:
// a streak is still alive if the last win was today or yesterday.
export function statsFrom(history, today) {
  const stats = { played: 0, won: 0, streak: 0, best: 0, dist: Array(MAX_GUESSES).fill(0) };
  const wins = new Set();
  for (const [key, game] of Object.entries(history)) {
    const n = Number(key);
    const result = outcome(n, game);
    if (!result.done) continue;
    stats.played += 1;
    if (result.won) {
      stats.won += 1;
      stats.dist[result.tries - 1] += 1;
      wins.add(n);
    }
  }
  for (const n of wins) {
    if (wins.has(n - 1)) continue;
    let run = 1;
    while (wins.has(n + run)) run += 1;
    stats.best = Math.max(stats.best, run);
    if (n + run - 1 >= today - 1) stats.streak = run;
  }
  return stats;
}

// Rebuilds a history from the old counter-style stats ({ played, won, streak, lastWon, last, dist }), so
// nobody loses their numbers. The current streak lands on the right days; other games go on the days
// before it, as close as the counts allow.
export function historyFromLegacy(s) {
  const history = {};
  if (!s || !(s.played > 0)) return history;
  const dist = Array.from({ length: MAX_GUESSES }, (_, i) => Math.max(0, Math.floor(Number(s.dist?.[i]) || 0)));
  const nextTries = () => {
    const i = dist.findIndex((c) => c > 0);
    if (i < 0) return 4;
    dist[i] -= 1;
    return i + 1;
  };
  const streak = Math.max(0, Math.floor(s.streak) || 0);
  let wins = Math.max(0, Math.floor(s.won) || 0);
  let losses = Math.max(0, Math.floor(s.played) - wins);
  for (let n = s.lastWon - streak + 1; streak && n <= s.lastWon; n++) {
    if (n >= 1) { history[n] = { legacy: true, won: true, tries: nextTries() }; wins -= 1; }
  }
  let n = streak ? s.lastWon - streak : s.last;
  if (!streak && s.last > 0 && losses > 0) { history[s.last] = { legacy: true, won: false, tries: MAX_GUESSES }; losses -= 1; n = s.last - 1; }
  for (; n >= 1 && (wins > 0 || losses > 0); n--) {
    if (history[n]) continue;
    if (losses > 0) { history[n] = { legacy: true, won: false, tries: MAX_GUESSES }; losses -= 1; }
    else { history[n] = { legacy: true, won: true, tries: nextTries() }; wins -= 1; }
  }
  return history;
}

const SQUARES ={ correct: '🟩', present: '🟨', absent: '⬜' };

export function shareText({ n, guesses, answer, won, url }) {
  const score = won ? guesses.length : 'X';
  const rows = guesses.map((guess) => grade(guess, answer).map((s) => SQUARES[s]).join(''));
  return [`🐴 Trustle #${n} ${score}/${MAX_GUESSES}`, '', ...rows, '', url].join('\n');
}
