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

// { word, hint, see? } for puzzle `n`.
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

const SQUARES = { correct: '🟩', present: '🟨', absent: '⬜' };

export function shareText({ n, guesses, answer, won, hint, url }) {
  const score = won ? guesses.length : 'X';
  const rows = guesses.map((guess) => grade(guess, answer).map((s) => SQUARES[s]).join(''));
  return [`🐴 Trustle #${n} ${score}/${MAX_GUESSES}${hint ? ' (with a hint)' : ''}`, '', ...rows, '', url].join('\n');
}
