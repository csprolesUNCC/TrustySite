import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  puzzleNumber, puzzleStart, puzzleWord, grade, letterStates, cleanGame, outcome, mergeGame, statsFrom, shareText, MAX_GUESSES,
  REWARDS, LOSS_REWARD, rewardFor, rewardable,
} from '../scripts/trustle.js';
import { FIRST_DAY, WORDS, PLACES } from '../scripts/trustle-words.js';

const root = new URL('../', import.meta.url);

test('puzzle #1 starts at midnight Eastern on FIRST_DAY', () => {
  const start = puzzleStart(1);
  assert.equal(new Date(start).toISOString().slice(0, 10), FIRST_DAY);
  assert.equal(puzzleNumber(start), 1);
  assert.equal(puzzleNumber(start - 1), 1, 'nothing before #1');
});

test('each puzzle starts exactly at its own midnight, across daylight saving changes', () => {
  // Covers the US clock changes on 2026-11-01 and 2027-03-14.
  for (let n = 2; n < 200; n++) {
    const start = puzzleStart(n);
    assert.equal(puzzleNumber(start), n, `#${n} at its start`);
    assert.equal(puzzleNumber(start - 1000), n - 1, `#${n - 1} one second before #${n}`);
    const hours = (start - puzzleStart(n - 1)) / 3600000;
    assert.ok([23, 24, 25].includes(hours), `day before #${n} is ${hours} hours`);
  }
});

test('the word list follows the rules in scripts/trustle-words.js', () => {
  const seen = new Set();
  for (const { word, see } of WORDS) {
    assert.match(word, /^[A-Z]{3,9}$/, `${word}: 3 to 9 letters, A to Z`);
    assert.ok(!see || PLACES[see], `${word}: unknown place "${see}"`);
    seen.add(word);
  }
  assert.ok(WORDS.length > 0);
  for (const [key, { href }] of Object.entries(PLACES)) {
    const file = href.split('#')[0].replace(/^\//, '');
    assert.ok(fs.existsSync(new URL(file, root)), `PLACES.${key} links to a missing page: ${href}`);
  }
});

test('every word length has a guess list', () => {
  for (let n = 3; n <= 9; n++) assert.ok(fs.existsSync(new URL(`data/trustle/${n}.txt`, root)), `data/trustle/${n}.txt`);
});

test('the list plays in order, then repeats shuffled without a word two days running', () => {
  for (let i = 0; i < WORDS.length; i++) assert.equal(puzzleWord(i + 1), WORDS[i]);
  for (let n = 2; n < WORDS.length * 4; n++) assert.notEqual(puzzleWord(n).word, puzzleWord(n - 1).word, `#${n}`);
  const secondRun = Array.from({ length: WORDS.length }, (_, i) => puzzleWord(WORDS.length + i + 1).word).sort();
  assert.deepEqual(secondRun, WORDS.map((w) => w.word).sort(), 'every word once per run');
});

test('grade() colours letters like Wordle, repeated letters included', () => {
  assert.deepEqual(grade('HORSE', 'HORSE'), Array(5).fill('correct'));
  assert.deepEqual(grade('SHORE', 'HORSE'), ['present', 'present', 'present', 'present', 'correct']);
  // Only one L in the answer: the right-spot L wins, the other L is absent.
  assert.deepEqual(grade('LLAMA', 'HELLO'), ['present', 'present', 'absent', 'absent', 'absent']);
  assert.deepEqual(grade('ALLEY', 'APPLE'), ['correct', 'present', 'absent', 'present', 'absent']);
  assert.deepEqual(letterStates(['ALLEY', 'APPLE'], 'APPLE'), { A: 'correct', L: 'correct', E: 'correct', Y: 'absent', P: 'correct' });
});

test('cleanGame() only keeps games that make sense', () => {
  const n = 1;
  const answer = puzzleWord(n).word;
  const wrong = 'Z'.repeat(answer.length);
  assert.deepEqual(cleanGame(n, { guesses: [wrong, answer] }), { guesses: [wrong, answer] });
  assert.equal(cleanGame(n, { guesses: [answer, wrong] }), null, 'nothing after the answer');
  assert.equal(cleanGame(n, { guesses: ['abc'] }), null, 'wrong length or lowercase');
  assert.equal(cleanGame(n, { guesses: Array(MAX_GUESSES + 1).fill(wrong) }), null, 'too many guesses');
  assert.equal(cleanGame(0, { guesses: [] }), null);
  assert.equal(cleanGame(n, { guesses: [{ $ne: null }] }), null);
  assert.deepEqual(cleanGame(n, { legacy: true, won: true, tries: 3, extra: 'x' }), { legacy: true, won: true, tries: 3 });
});

test('outcome(), mergeGame() and statsFrom() agree on a history', () => {
  const word = (n) => puzzleWord(n).word;
  const miss = (n) => 'Z'.repeat(word(n).length);
  const history = {
    1: { guesses: [word(1)] },
    2: { guesses: [miss(2), word(2)] },
    3: { guesses: Array(MAX_GUESSES).fill(miss(3)) },
    5: { guesses: [miss(5)] }, // still being played
  };
  assert.deepEqual(outcome(2, history[2]), { done: true, won: true, tries: 2 });
  assert.deepEqual(outcome(3, history[3]), { done: true, won: false, tries: MAX_GUESSES });
  assert.deepEqual(outcome(5, history[5]), { done: false, won: false, tries: 1 });

  const stats = statsFrom(history, 3);
  assert.equal(stats.played, 3);
  assert.equal(stats.won, 2);
  assert.equal(stats.best, 2);
  assert.equal(stats.streak, 2, 'yesterday’s win keeps the streak alive');
  assert.equal(statsFrom(history, 5).streak, 0, 'two days later it’s gone');

  // A game that carries on from the other device's wins; a real game beats a rebuilt one.
  assert.deepEqual(mergeGame({ guesses: [miss(5)] }, { guesses: [miss(5), word(5)] }), { guesses: [miss(5), word(5)] });
  assert.deepEqual(mergeGame({ legacy: true, won: true, tries: 2 }, { guesses: [word(1)] }), { guesses: [word(1)] });
});

test('rewardFor() pays more for fewer guesses, a little for running out, and nothing for unfinished or rebuilt games', () => {
  assert.deepEqual(REWARDS, [200, 100, 50, 35, 25, 15]);
  assert.equal(LOSS_REWARD, 5);
  const n = 3;
  const answer = puzzleWord(n).word;
  const miss = 'Z'.repeat(answer.length);
  for (let tries = 1; tries <= MAX_GUESSES; tries++) {
    assert.equal(rewardFor(n, { guesses: [...Array(tries - 1).fill(miss), answer] }), REWARDS[tries - 1], `got it in ${tries}`);
  }
  assert.equal(rewardFor(n, { guesses: Array(MAX_GUESSES).fill(miss) }), LOSS_REWARD, 'out of guesses');
  assert.equal(rewardFor(n, { guesses: [miss] }), 0, 'still playing');
  assert.equal(rewardFor(n, { guesses: [] }), 0);
  assert.equal(rewardFor(n, { legacy: true, won: true, tries: 1 }), 0, 'rebuilt from the old stats');
  assert.equal(rewardFor(n, null), 0);
});

test('only puzzles within a day of today’s pay', () => {
  const today = 200;
  assert.ok(rewardable(today, today));
  assert.ok(rewardable(today - 1, today), 'finished just after midnight');
  assert.ok(rewardable(today + 1, today), 'a clock that’s a little ahead');
  assert.ok(!rewardable(today - 2, today), 'old puzzles can’t be collected later');
  assert.ok(!rewardable(today + 2, today));
});

test('the Trustle page lists the same rewards', () => {
  const html = fs.readFileSync(new URL('pages/games/trustle.html', root), 'utf8');
  const table = /<dl[^>]* id="reward-table"[^>]*>([\s\S]*?)<\/dl>/.exec(html);
  assert.ok(table, 'pages/games/trustle.html has no reward table (id="reward-table")');
  const listed = [...table[1].matchAll(/<dd>([\d,]+)<\/dd>/g)].map((m) => Number(m[1].replace(/,/g, '')));
  assert.deepEqual(listed, [...REWARDS, LOSS_REWARD]);
});

test('shareText() has the puzzle number, score and one row per guess', () => {
  const text = shareText({ n: 7, guesses: ['SHORE', 'HORSE'], answer: 'HORSE', won: true, url: 'https://trustydahorse.com' });
  assert.equal(text, '🐴 Trustle #7 2/6\n\n🟨🟨🟨🟨🟩\n🟩🟩🟩🟩🟩\n\nhttps://trustydahorse.com');
});
