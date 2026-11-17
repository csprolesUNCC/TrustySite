// Trusty Poker against the bots (utils/solo-poker-game.js), with games kept in memory and the in-memory bank from
// tools/mock-bank.mjs.
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { play, cleanMove, memoryGames, STALE_MS, HERO } from '../utils/solo-poker-game.js';
import soloApi from '../utils/solo-poker.js';
import { CASH_OUT_TIMES } from '../scripts/poker.js';
import { mockBank } from '../tools/mock-bank.mjs';
import { seeded } from './seeded.js';

const ME = 'u1';

function game({ clicks = 1000, seed = 3 } = {}) {
  let clock = 1_000_000;
  let ids = 0;
  const store = memoryGames();
  const bank = mockBank({ startingClicks: clicks, delay: 0 });
  const deps = { ...store, bank, now: () => clock, random: seeded(seed), newId: () => (++ids).toString(16).padStart(16, '0') };
  return {
    deps,
    store,
    move: (m) => play(deps, ME, m && cleanMove(m)),
    look: () => play(deps, ME, null),
    clicks: () => bank.status(ME).clicks,
    open: () => bank.account(ME).open.size,
    wait: (ms) => { clock += ms; },
  };
}

// Plays your turns with `choose(legal)` until the hand is over.
async function playHand(g, shown, choose = (can) => (can.check ? { do: 'check' } : { do: 'call' })) {
  for (let guard = 0; shown.table.hand.street !== 'over'; guard++) {
    assert.ok(guard < 50);
    assert.equal(shown.table.hand.toAct, HERO, 'between your moves, only your turn or the end');
    shown = await g.move({ do: 'act', action: choose(shown.table.hand.legal) });
    assert.equal(shown.error, undefined, shown.error);
  }
  return shown;
}

test('only real moves get through', () => {
  assert.deepEqual(cleanMove({ do: 'sit', buyIn: 200, bots: 3 }), { do: 'sit', buyIn: 200, bots: 3 });
  assert.deepEqual(cleanMove({ do: 'sit', buyIn: 100 }), { do: 'sit', buyIn: 100, bots: 5 });
  for (const junk of [{ do: 'sit', buyIn: 150 }, { do: 'sit', buyIn: 100, bots: 0 }, { do: 'sit', buyIn: 100, bots: 6 }, { do: 'sit', buyIn: { $gt: 0 } },
    { do: 'act' }, { do: 'act', action: { do: 'raise', to: 'all' } }, { do: 'win' }, null, []]) {
    assert.equal(cleanMove(junk), null, JSON.stringify(junk));
  }
  assert.deepEqual(cleanMove({ do: 'act', action: { do: 'raise', to: 20 } }), { do: 'act', action: { do: 'raise', to: 20 } });
});

test('a sit: the buy-in comes off, hands get played, the stack goes back', async () => {
  const g = game();
  let shown = await g.move({ do: 'sit', buyIn: 200, bots: 3 });
  assert.equal(g.clicks(), 800);
  assert.equal(g.open(), 1);
  assert.deepEqual(shown.sit, { buyIn: 200, bots: 3 });
  assert.equal(shown.table.seats.filter(Boolean).length, 4);
  assert.equal(shown.table.hand.players[HERO].cards.length, 2);
  for (const [i, p] of shown.table.hand.players.entries()) if (p && i !== HERO && !shown.table.hand.result) assert.equal(p.cards, null, 'no peeking');
  for (let n = 0; n < 5 && shown.sit; n++) {
    if (shown.table.hand.street !== 'over') shown = await playHand(g, shown);
    shown = await g.move({ do: 'next' });
  }
  if (shown.sit) {
    const stack = shown.table.seats[HERO].stack;
    shown = await g.move({ do: 'leave' });
    const left = shown.table.seats[HERO].stack; // leaving mid-hand folds what you have in
    assert.ok(left <= stack);
    assert.equal(shown.last.payout, left);
    assert.equal(g.clicks(), 800 + left);
  } else {
    assert.equal(g.clicks(), 800 + shown.last.payout);
  }
  assert.equal(shown.sit, null);
  assert.equal(g.open(), 0, 'the buy-in is settled');
});

test('the bots act inside your move, and the page is told what they did', async () => {
  const g = game({ seed: 11 });
  let shown = await g.move({ do: 'sit', buyIn: 100, bots: 5 });
  for (let n = 0; n < 10 && shown.table.hand.street === 'over'; n++) shown = await g.move({ do: 'next' });
  assert.equal(shown.table.hand.toAct, HERO);
  const at = shown.table.hand.log.length;
  shown = await g.move({ do: 'act', action: { do: 'call' } });
  const log = shown.table.hand.log;
  assert.equal(shown.table.hand.logAt, at, 'only what happened in this move');
  assert.equal(log[0].seat, HERO);
  assert.ok(log.length > 1);
});

test('moves out of turn, and a buy-in the bank refuses, change nothing', async () => {
  const g = game({ clicks: 50 });
  let shown = await g.move({ do: 'sit', buyIn: 100 });
  assert.match(shown.error, /only have 50/);
  assert.equal(shown.sit, null);
  assert.equal(g.clicks(), 50);
  assert.match((await g.move({ do: 'next' })).error, /Buy in first/);
  const rich = game();
  shown = await rich.move({ do: 'sit', buyIn: 100, bots: 1 });
  assert.match((await rich.move({ do: 'sit', buyIn: 100 })).error, /already/);
  if (shown.table.hand.street !== 'over') assert.match((await rich.move({ do: 'next' })).error, /Finish/);
  else assert.match((await rich.move({ do: 'act', action: { do: 'fold' } })).error, /not your turn/);
});

test('busting out ends the sit with nothing back; a big stack is cashed out', async () => {
  const g = game({ seed: 5 });
  let shown = await g.move({ do: 'sit', buyIn: 100, bots: 1 });
  const allIn = (can) => (can.raise ? { do: 'raise', to: can.raise.max } : can.check ? { do: 'check' } : { do: 'call' });
  for (let n = 0; n < 200 && shown.sit; n++) {
    if (shown.table.hand.street !== 'over') shown = await playHand(g, shown, allIn);
    shown = await g.move({ do: 'next' });
  }
  assert.equal(shown.sit, null, 'shoving every hand ends one way or the other');
  assert.ok(['bust', 'cashout'].includes(shown.last.why));
  if (shown.last.why === 'bust') assert.equal(shown.last.payout, 0);
  else assert.ok(shown.last.payout >= CASH_OUT_TIMES * 100);
  assert.equal(g.clicks(), 900 + shown.last.payout);
  assert.equal(g.open(), 0);
});

test('a sit left alone is played out and cashed out on the next visit', async () => {
  const g = game();
  await g.move({ do: 'sit', buyIn: 200 });
  g.wait(STALE_MS + 1);
  const shown = await g.look();
  assert.equal(shown.sit, null);
  assert.equal(shown.last.why, 'away');
  assert.equal(g.open(), 0);
  assert.equal(g.clicks(), 800 + shown.last.payout);
});

test('a buy-in another tab beat gives its stake back', async () => {
  const g = game();
  const save = g.deps.save;
  g.deps.save = async () => false; // someone else saved first
  const shown = await g.move({ do: 'sit', buyIn: 200 });
  g.deps.save = save;
  assert.match(shown.error, /another tab/);
  assert.equal(g.clicks(), 1000);
  assert.equal(g.open(), 0);
});

test('the endpoint turns away strangers and junk before touching the database', async () => {
  const res = () => ({ code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  let r = res();
  await soloApi({ method: 'GET', headers: {}, query: {} }, r);
  assert.equal(r.code, 401);
  r = res();
  await soloApi({ method: 'DELETE', headers: {}, query: {} }, r);
  assert.equal(r.code, 405);
});
