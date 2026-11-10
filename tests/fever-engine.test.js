import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, PLAYERS } from '../scripts/fever-engine.js';

// The same seeded random numbers (mulberry32) every run, so a match plays out the same way each time.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playOut(seed, setup, maxSteps = 60 * 60 * 20) {
  const match = createMatch(setup, { random: seeded(seed), readySteps: 1, firstReadySteps: 1, endSteps: 1 });
  match.begin();
  const log = [];
  for (let step = 0; step < maxSteps; step++) {
    for (const e of match.update()) {
      if (e.type !== 'ink') log.push(`${step}:${e.type}:${e.id ?? ''}`);
      if (e.type === 'gameOver') return { match, log, winner: e.id, steps: step };
    }
  }
  return { match, log, winner: null, steps: maxSteps };
}

test('computer players finish a match, and the winner has the most points', () => {
  const setup = { humans: 0, bots: 4, skill: 'hard', powerups: true, length: 5 };
  const { match, winner } = playOut(1, setup);
  assert.ok(winner, 'someone won');
  const best = Math.max(...match.players.map((p) => p.score));
  assert.equal(match.players.find((p) => p.id === winner).score, best);
  assert.ok(best >= match.target, `winner reached the target (${best} of ${match.target})`);
});

test('the same seed plays the same match', () => {
  const setup = { humans: 0, bots: 3, skill: 'normal', powerups: true, length: 5 };
  assert.deepEqual(playOut(42, setup).log, playOut(42, setup).log);
});

test('no more players than there are colours', () => {
  const { match } = playOut(7, { humans: 2, bots: 20, skill: 'easy', powerups: false, length: 5 }, 10);
  assert.equal(match.players.length, PLAYERS.length);
});
