// The Daily Games board (scripts/daily-games.js, utils/daily.js): reading share text, the checks that turn away
// made-up grids and old puzzles, ranking, flags, stats, and the API's input checks before any database.
import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import {
  GAMES, KRILLION, parseShare, dayOfPuzzle, puzzleOn, postableDays, rankOf, describe, places, flagsFor, statsFor, cleanResult, krillionScore,
} from '../scripts/daily-games.js';
import daily from '../utils/daily.js';

const TODAY = '2026-11-23';
const n = (game) => puzzleOn(game, TODAY);

test('puzzle numbers line up with their days', () => {
  assert.equal(dayOfPuzzle('wordle', 1000), '2024-03-15');
  assert.equal(dayOfPuzzle('connections', 1), '2023-06-12');
  assert.equal(dayOfPuzzle('krillion', 1), '2026-07-16');
  assert.equal(dayOfPuzzle('krillion', 94), '2026-10-17');
  for (const game of Object.keys(GAMES)) assert.equal(dayOfPuzzle(game, n(game)), TODAY);
  assert.deepEqual(postableDays(TODAY), ['2026-11-22', '2026-11-23', '2026-11-24']);
});

test('Wordle: reads the score and grid, in every color scheme', () => {
  const read = parseShare(`Wordle ${n('wordle').toLocaleString('en-US')} 3/6*\n\n⬛🟨⬛⬛⬛\n🟩🟩⬛🟨⬛\n🟩🟩🟩🟩🟩\n`, TODAY);
  assert.deepEqual(read, { game: 'wordle', n: n('wordle'), day: TODAY, result: { guesses: 3, hard: true, grid: ['apaaa', 'ccapa', 'ccccc'] } });
  const contrast = parseShare(`Wordle ${n('wordle')} 2/6\n\n⬜🟦⬜⬜🟧\n🟧🟧🟧🟧🟧`, TODAY);
  assert.deepEqual(contrast.result.grid, ['apaac', 'ccccc']);
  const lost = parseShare(`Wordle ${n('wordle')} X/6\n${'⬛🟨⬛⬛⬛\n'.repeat(6)}`, TODAY);
  assert.equal(lost.result.guesses, null);
  assert.equal(describe('wordle', lost.result), 'X/6');
});

test('Wordle: a grid that doesn’t match its score is turned away', () => {
  const bad = [
    `Wordle ${n('wordle')} 2/6\n⬛🟨⬛⬛⬛\n🟩🟩⬛🟨⬛\n🟩🟩🟩🟩🟩`, // 3 rows for 2/6
    `Wordle ${n('wordle')} 3/6\n🟩🟩🟩🟩🟩\n🟩🟩⬛🟨⬛\n🟩🟩🟩🟩🟩`, // solved before the end
    `Wordle ${n('wordle')} 2/6\n⬛🟨⬛⬛⬛\n🟩🟩⬛🟨⬛`, // never solved
    `Wordle ${n('wordle')} X/6\n${'⬛🟨⬛⬛⬛\n'.repeat(5)}🟩🟩🟩🟩🟩`, // solved but X
    `Wordle ${n('wordle')} 3/6`, // no grid at all
  ];
  for (const text of bad) assert.ok(parseShare(text, TODAY).error, text);
});

test('Connections: wins, mistakes and losses', () => {
  const win = parseShare(`Connections\nPuzzle #${n('connections').toLocaleString('en-US')}\n🟨🟨🟨🟨\n🟩🟦🟩🟩\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪`, TODAY);
  assert.deepEqual(win.result, { won: true, mistakes: 1, found: 4, grid: ['yyyy', 'gbgg', 'gggg', 'bbbb', 'pppp'] });
  assert.equal(describe('connections', win.result), '1 mistake');
  const perfect = parseShare(`Connections\nPuzzle #${n('connections')}\n🟪🟪🟪🟪\n🟦🟦🟦🟦\n🟩🟩🟩🟩\n🟨🟨🟨🟨`, TODAY);
  assert.equal(describe('connections', perfect.result), 'Perfect');
  const lost = parseShare(`Connections\nPuzzle #${n('connections')}\n🟨🟨🟨🟨\n🟩🟦🟩🟩\n🟩🟦🟩🟩\n🟪🟦🟩🟩\n🟩🟦🟪🟩`, TODAY);
  assert.deepEqual([lost.result.won, lost.result.found, lost.result.mistakes], [false, 1, 4]);
  assert.ok(rankOf('connections', lost.result) > rankOf('connections', { won: true, mistakes: 3 }));
  // The same group found twice, or a game that went on after the fourth mistake
  assert.ok(parseShare(`Connections\nPuzzle #${n('connections')}\n🟨🟨🟨🟨\n🟨🟨🟨🟨\n🟦🟦🟦🟦\n🟪🟪🟪🟪`, TODAY).error);
  assert.ok(parseShare(`Connections\nPuzzle #${n('connections')}\n${'🟩🟦🟩🟩\n'.repeat(4)}🟨🟨🟨🟨`, TODAY).error);
});

test('Krillion: real share text from krillion.io', () => {
  // Pasted straight from the game (a 28th percentile dive).
  const real = 'Krillion #130 🦐\n245\n\n🐟🐟🐟🐟🐟🏮🫧';
  assert.deepEqual(parseShare(real, '2026-11-22'), { game: 'krillion', n: 130, day: '2026-11-22', result: { score: 245, grid: ['3333351'] } });
  assert.ok(parseShare(real.replace('245', '400'), '2026-11-22').error); // the score edited, the emoji not
});

test('Krillion: the score is worked out from the emoji, and has to match a score line', () => {
  const read = parseShare(`Krillion #${n('krillion')} 🦐\n300/700\n🌟🦑🐟🏮⬛🫧🤡`, TODAY);
  assert.deepEqual(read.result, { score: 300, grid: ['6435m12'] });
  assert.equal(describe('krillion', read.result), '300/700');
  // Spaces between the emoji, the row on the header's line, depth in meters
  assert.equal(parseShare(`Krillion #${n('krillion')} 🦐 🌟 🦑 🐟 🏮 ⬛ 🫧 🤡 Top 5%`, TODAY).result.score, 300);
  assert.equal(parseShare(`Krillion #${n('krillion')}\n3,000m deep\n🌟🦑🐟🏮⬛🫧🤡`, TODAY).result.score, 300);
  assert.ok(parseShare(`Krillion #${n('krillion')} 🦐\n650/700\n🌟🦑🐟🏮⬛🫧🤡`, TODAY).error);
  assert.ok(parseShare(`Krillion #${n('krillion')} 🦐\n🌟🦑🐟🏮⬛🫧`, TODAY).error); // 6 prompts
  assert.equal(KRILLION.max, 700);
  assert.equal(krillionScore('6666666'), 700);
});

test('only today’s puzzles (give or take a day) can be posted', () => {
  assert.ok(parseShare(`Wordle ${n('wordle') - 1} 1/6\n🟩🟩🟩🟩🟩`, TODAY).day);
  assert.ok(parseShare(`Wordle ${n('wordle') + 1} 1/6\n🟩🟩🟩🟩🟩`, TODAY).day);
  assert.ok(parseShare(`Wordle ${n('wordle') - 2} 1/6\n🟩🟩🟩🟩🟩`, TODAY).error);
  assert.ok(parseShare(`Wordle ${n('wordle') + 2} 1/6\n🟩🟩🟩🟩🟩`, TODAY).error);
  assert.ok(parseShare('just some words', TODAY).error);
  assert.ok(parseShare({ $ne: null }, TODAY).error);
  assert.ok(parseShare('x'.repeat(5000), TODAY).error);
});

test('ranking: ties share a place', () => {
  assert.deepEqual(places([{ rank: 2 }, { rank: 3 }, { rank: 3 }, { rank: 5 }]), [1, 2, 2, 4]);
  assert.ok(rankOf('krillion', { score: 500 }) < rankOf('krillion', { score: 300 }));
  assert.ok(rankOf('wordle', { guesses: 6 }) < rankOf('wordle', { guesses: null }));
});

test('flags: results that are hard to believe', () => {
  assert.equal(flagsFor('wordle', { guesses: 1 }).length, 1);
  assert.deepEqual(flagsFor('wordle', { guesses: 4 }), []);
  const lucky = Array.from({ length: 12 }, () => ({ guesses: 2 }));
  assert.equal(flagsFor('wordle', { guesses: 3 }, lucky).length, 1);
  const perfect = { won: true, mistakes: 0 };
  assert.deepEqual(flagsFor('connections', perfect, Array(13).fill(perfect)), []);
  assert.equal(flagsFor('connections', perfect, Array(14).fill(perfect)).length, 1);
  assert.equal(flagsFor('krillion', { score: 700 }).length, 1);
  assert.deepEqual(flagsFor('krillion', { score: 420 }, Array(15).fill({ score: 400 })), []);
});

test('stats: streaks run to today or yesterday', () => {
  const entries = ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-19'].map((day, i) => ({ day, result: { guesses: i + 2, hard: false, grid: [] } }));
  const stats = statsFor('wordle', entries, TODAY);
  assert.equal(stats.played, 4);
  assert.equal(stats.streak, 3);
  assert.equal(stats.average, 3.5);
  assert.equal(statsFor('wordle', entries.slice(0, 2), TODAY).streak, 2); // today not in yet
});

test('cleanResult() only passes results the parser could have made', () => {
  assert.ok(cleanResult('wordle', { guesses: 3, hard: false, grid: ['apaaa', 'ccapa', 'ccccc'] }));
  assert.equal(cleanResult('wordle', { guesses: 3, grid: ['<img>'] }), null);
  assert.equal(cleanResult('krillion', { score: 700, grid: ['1111111'] }), null);
  assert.equal(cleanResult('nope', {}), null);
});

function call(handler, { method = 'GET', query = {}, body, user } = {}) {
  const headers = user ? { cookie: `authToken=${jwt.sign(user, process.env.JWT_SECRET, { algorithm: 'HS256' })}` } : {};
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    handler({ method, query: { action: 'daily', ...query }, body, headers, cookies: {} }, res);
  });
}

test('the API checks what it’s sent before going near the database', async () => {
  const user = { userId: '0123456789abcdef01234567', username: 'tester' };
  assert.equal((await call(daily, { method: 'POST', body: { text: 'Wordle 1 1/6' } })).status, 401);
  assert.equal((await call(daily, { method: 'POST', user, body: { text: { $ne: null } } })).status, 400);
  assert.equal((await call(daily, { method: 'POST', user, body: { text: 'Wordle 5 3/6\n🟩🟩🟩🟩🟩' } })).status, 400);
  assert.equal((await call(daily, { method: 'POST', user, body: { do: 'report', id: { $gt: '' } } })).status, 400);
  assert.equal((await call(daily, { query: { day: { $gt: '' } } })).status, 400);
  assert.equal((await call(daily, { query: { day: '2099-01-01' } })).status, 400);
  assert.equal((await call(daily, { method: 'PUT' })).status, 405);
});

test('the page links every game it says it covers', () => {
  const page = fs.readFileSync(new URL('../pages/daily.html', import.meta.url), 'utf8');
  for (const game of Object.values(GAMES)) assert.match(page, new RegExp(game.name), `${game.name} isn't named on the page`);
});
