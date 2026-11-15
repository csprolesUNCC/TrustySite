// Trusty Slots: the rules and machines (scripts/slots.js) and the game for clicks (utils/solo-slots-game.js), with
// games kept in memory and the in-memory bank from tools/mock-bank.mjs.
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { MACHINES, MACHINE_KEYS, BETS, CHIPS, RTP, MAX_RETURN, REELS, isBet, spin, isStops, symbolAt, lineOf, payFor, tierOf, rtp } from '../scripts/slots.js';
import { play, cleanMove, memoryGames } from '../utils/solo-slots-game.js';
import slotsApi from '../utils/solo-slots.js';
import { MAX_RETURN as BANK_MAX, GAMES, LIMITS } from '../utils/bank-rules.js';
import { mockBank } from '../tools/mock-bank.mjs';

const ME = 'u1';
// Reel stops that put these symbols on the payline.
const stopsFor = (machine, line) => line.map((symbol) => machine.strip.indexOf(symbol));
// A random() that makes spin() stop the reels there.
const rigged = (machine, stops) => {
  let i = 0;
  return () => (stops[i++ % stops.length] + 0.5) / machine.strip.length;
};

/* ---------- The machines ---------- */

test('the house always wins: every machine pays back less than is bet, but not much less', () => {
  for (const machine of Object.values(MACHINES)) {
    const { rtp: back, hit } = rtp(machine);
    assert.ok(back >= RTP.min && back <= RTP.max, `${machine.key} pays back ${(back * 100).toFixed(2)}%`);
    assert.ok(back < 1, `${machine.key} has to lose money for its players`);
    assert.ok(hit > 0.15 && hit < 0.5, `${machine.key} pays on ${(hit * 100).toFixed(1)}% of spins`);
  }
});

test('every machine is put together properly', () => {
  assert.ok(MACHINE_KEYS.length >= 2);
  for (const [key, machine] of Object.entries(MACHINES)) {
    assert.equal(machine.key, key);
    const symbols = Object.keys(machine.symbols);
    assert.deepEqual([...new Set(machine.strip)].sort(), [...symbols].sort(), `${key}: every symbol is on the strip, and nothing else`);
    assert.deepEqual(Object.keys(machine.three).sort(), [...symbols].sort(), `${key}: three of anything pays`);
    for (const symbol of Object.keys(machine.two)) {
      assert.ok(symbols.includes(symbol), `${key}: ${symbol}`);
      assert.ok(machine.two[symbol] < machine.three[symbol], `${key}: two ${symbol} pay less than three`);
    }
    for (const times of [...Object.values(machine.three), ...Object.values(machine.two)]) {
      assert.ok(Number.isSafeInteger(times) && times >= 2, `${key}: a win pays the bet back and more, in whole clicks`);
    }
    assert.equal(machine.three[machine.jackpot], Math.max(...Object.values(machine.three)), `${key}: the jackpot pays the most`);
    if (machine.chars) assert.deepEqual(Object.keys(machine.chars).sort(), [...symbols].sort(), `${key}: a character for every symbol`);
    // No symbol sits next to itself on the strip, so a reel never shows the same one twice in a row.
    machine.strip.forEach((symbol, i) => assert.notEqual(symbol, symbolAt(machine, i, 1), `${key}: stop ${i}`));
  }
});

test('bets are tens from 10 to 100, and the bank will pay the biggest jackpot', () => {
  assert.deepEqual([0, 5, 10, 15, 100, 110, 10.5, '10', NaN].map(isBet), [false, false, true, false, true, false, false, false, false]);
  assert.ok(CHIPS.every(isBet));
  assert.ok(BETS.max <= LIMITS.maxStake);
  assert.ok(GAMES.includes('slots'));
  assert.equal(BANK_MAX.slots, MAX_RETURN, 'utils/bank-rules.js caps a spin at the biggest jackpot');
});

test('what a payline pays', () => {
  const { hay, golden } = MACHINES;
  assert.deepEqual(payFor(hay, ['trusty', 'trusty', 'trusty']), { times: 50, kind: 'three', symbol: 'trusty' });
  assert.deepEqual(payFor(hay, ['hay', 'apple', 'hay']), { times: 2, kind: 'two', symbol: 'hay' });
  assert.deepEqual(payFor(hay, ['seven', 'seven', 'hay']), { times: 5, kind: 'two', symbol: 'seven' });
  assert.equal(payFor(hay, ['pencil', 'pencil', 'shoe']).times, 0, 'two pencils pay nothing');
  assert.equal(payFor(hay, ['hay', 'apple', 'carrot']).times, 0);
  assert.deepEqual(payFor(golden, ['ma', 'ma', 'ma']), { times: 88, kind: 'three', symbol: 'ma' });
  assert.deepEqual(payFor(golden, ['fu', 'ma', 'ma']), { times: 8, kind: 'two', symbol: 'ma' });
  assert.equal(payFor(golden, ['fu', 'fu', 'xi']).times, 0);
  assert.equal(tierOf(hay, payFor(hay, ['trusty', 'trusty', 'trusty'])), 'jackpot');
  assert.equal(tierOf(hay, payFor(hay, ['seven', 'seven', 'seven'])), 'big');
  assert.equal(tierOf(hay, payFor(hay, ['hay', 'hay', 'hay'])), 'win');
  assert.equal(tierOf(hay, payFor(hay, ['hay', 'apple', 'carrot'])), null);
});

test('spins stop somewhere on the strip, and the strip goes round', () => {
  for (const machine of Object.values(MACHINES)) {
    const n = machine.strip.length;
    assert.deepEqual(spin(machine, () => 0), [0, 0, 0]);
    assert.deepEqual(spin(machine, () => 0.999999), [n - 1, n - 1, n - 1]);
    assert.equal(spin(machine, Math.random).length, REELS);
    assert.equal(symbolAt(machine, 0, -1), machine.strip[n - 1]);
    assert.equal(symbolAt(machine, n - 1, 1), machine.strip[0]);
    assert.ok(isStops(machine, [0, n - 1, 3]));
    for (const bad of [[0, 0], [0, 0, n], [0, 0, -1], [0, 0, 1.5], 'abc', null]) assert.ok(!isStops(machine, bad));
  }
});

test('the page’s paytable is drawn from the machines, not typed in', () => {
  const page = fs.readFileSync(new URL('../pages/games/slots.html', import.meta.url), 'utf8');
  assert.match(page, /from '\/scripts\/slots\.js'/);
  for (const key of MACHINE_KEYS) assert.ok(page.includes(`data-machine="${key}"`), `a button for ${key}`);
});

/* ---------- The game ---------- */

test('only real spins get through', () => {
  assert.deepEqual(cleanMove({ do: 'spin', machine: 'hay', amount: 50 }), { do: 'spin', machine: 'hay', amount: 50 });
  assert.deepEqual(cleanMove({ do: 'spin', machine: 'golden', amount: 10, payout: 9999 }), { do: 'spin', machine: 'golden', amount: 10 });
  for (const bad of [
    null, 'spin', {}, { do: 'roll', machine: 'hay', amount: 10 }, { do: 'spin', machine: 'hay' },
    { do: 'spin', machine: 'hay', amount: 500 }, { do: 'spin', machine: 'hay', amount: 15 }, { do: 'spin', machine: 'hay', amount: '10' },
    { do: 'spin', machine: 'hay', amount: { $gt: 0 } }, { do: 'spin', machine: 'toString', amount: 10 },
    { do: 'spin', machine: '__proto__', amount: 10 }, { do: 'spin', machine: { $ne: null }, amount: 10 },
  ]) assert.equal(cleanMove(bad), null, JSON.stringify(bad));
});

function game({ clicks = 1000 } = {}) {
  const bank = mockBank({ startingClicks: clicks, delay: 0 });
  const store = memoryGames();
  let ids = 0;
  const deps = { ...store, bank, now: () => 1000, random: Math.random, newId: () => String(++ids).padStart(16, '0') };
  return {
    bank, store, deps,
    spin(machine, amount, line) {
      if (line) deps.random = rigged(MACHINES[machine], stopsFor(MACHINES[machine], line));
      return play(deps, ME, { do: 'spin', machine, amount });
    },
    look: () => play(deps, ME, null),
    clicks: () => bank.account(ME).clicks,
    open: () => bank.account(ME).open.size,
  };
}

test('a spin: a loss takes the bet, a win pays the paytable', async () => {
  const g = game();
  assert.deepEqual(await g.look(), { last: null, spins: 0, bets: BETS, bank: null });
  let shown = await g.spin('hay', 50, ['hay', 'apple', 'carrot']);
  assert.deepEqual(shown.bank, { clicks: 950, net: -50 });
  assert.equal(shown.last.payout, 0);
  assert.deepEqual(shown.last.line, ['hay', 'apple', 'carrot']);
  shown = await g.spin('hay', 50, ['carrot', 'carrot', 'carrot']);
  assert.deepEqual(shown.bank, { clicks: 1150, net: 150 });
  assert.equal(shown.last.payout, 250);
  assert.equal(shown.last.times, 5);
  assert.equal(shown.spins, 2);
  shown = await g.spin('golden', 100, ['ma', 'ma', 'ma']);
  assert.equal(shown.last.payout, 8800, 'the bank pays the biggest jackpot at the biggest bet');
  assert.equal(g.clicks(), 1150 - 100 + 8800);
  assert.equal(g.open(), 0);
  assert.equal(g.bank.status(ME).month.slots, -50 + 200 + 8700);
  assert.ok(isStops(MACHINES.golden, shown.last.stops));
  assert.deepEqual(lineOf(MACHINES.golden, shown.last.stops), shown.last.line);
});

test('a spin the bank turns down doesn’t spin', async () => {
  const g = game({ clicks: 40 });
  const shown = await g.spin('hay', 50, ['trusty', 'trusty', 'trusty']);
  assert.match(shown.error, /only have 40/);
  assert.equal(shown.spins, 0);
  assert.equal(shown.last, null);
  assert.equal(g.clicks(), 40);
});

test('a payout that didn’t get through is paid on the next visit, once', async () => {
  const g = game();
  const real = g.bank.settle;
  g.deps.bank = { ...g.bank, settle: async () => { throw new Error('the bank is down'); } };
  await assert.rejects(g.spin('hay', 100, ['seven', 'seven', 'seven']));
  assert.equal(g.clicks(), 900);
  g.deps.bank = { ...g.bank, settle: real };
  const shown = await g.look();
  assert.deepEqual(shown.bank, { clicks: 3900, net: 2900 });
  await g.look();
  assert.equal(g.clicks(), 3900, 'paid once');
});

test('two tabs: the spin that lost the race gets its bet back', async () => {
  const g = game();
  await g.spin('hay', 10, ['hay', 'apple', 'carrot']);
  const stale = await g.store.load(ME);
  await g.spin('hay', 10, ['hay', 'apple', 'carrot']); // another tab spins
  const load = g.deps.load;
  g.deps.load = async () => { g.deps.load = load; return structuredClone(stale); };
  const shown = await g.spin('golden', 100, ['ma', 'ma', 'ma']);
  assert.match(shown.error, /another tab/);
  assert.equal(g.clicks(), 980, 'the bet came back, and the jackpot never happened');
  assert.equal(g.open(), 0);
  assert.equal(shown.spins, 2);
});

test('a bet waiting on its spin is never given back by the bank', async () => {
  const g = game();
  g.deps.bank = { ...g.bank, settle: async () => { throw new Error('the bank is down'); } };
  await assert.rejects(g.spin('hay', 10));
  assert.equal(g.bank.account(ME).open.values().next().value.solo, true);
});

test('over many spins, the players lose', async () => {
  const g = game({ clicks: 10_000_000 });
  g.bank.account(ME); // made
  // A seeded generator, so this never flakes.
  let seed = 20261115;
  g.deps.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  let bet = 0;
  let back = 0;
  for (let i = 0; i < 4000; i++) {
    g.bank.account(ME).net = 0; // no daily limits here
    const shown = await play(g.deps, ME, { do: 'spin', machine: i % 2 ? 'hay' : 'golden', amount: 10 });
    bet += 10;
    back += shown.last.payout;
  }
  assert.ok(back < bet, `${back} back on ${bet} bet`);
  assert.equal(g.bank.house().games.slots, bet - back);
});

function call({ method = 'GET', body, user } = {}) {
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
  const cookie = user ? `authToken=${jwt.sign(user, process.env.JWT_SECRET)}` : undefined;
  return Promise.resolve(slotsApi({ method, query: { action: 'slots' }, headers: { cookie }, body }, res)).then(() => res);
}

test('the endpoint turns away strangers and junk before touching the database', async () => {
  assert.equal((await call()).statusCode, 401);
  assert.equal((await call({ method: 'POST', body: { do: 'spin', machine: 'hay', amount: 10 } })).statusCode, 401);
  const user = { userId: 'u1', username: 'carson' };
  assert.equal((await call({ method: 'POST', user, body: { do: 'spin', machine: 'hay', amount: { $gt: 0 } } })).statusCode, 400);
  assert.equal((await call({ method: 'POST', user, body: { do: 'spin', machine: { $ne: null }, amount: 10 } })).statusCode, 400);
  assert.equal((await call({ method: 'DELETE', user })).statusCode, 405);
});
