// Trusty Slots: the rules, the machine and its Golden Horse bonus (scripts/slots.js) and the game for clicks
// (utils/solo-slots-game.js), with games kept in memory and the in-memory bank from tools/mock-bank.mjs.
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import {
  MACHINE, BONUS, JACKPOT, BETS, CHIPS, RTP, MAX_RETURN, REELS, isBet, jackpotChance, spin, isStops, symbolAt, lineOf, payFor, scattersAt, triggers,
  play as spinMachine, tierOf, rtp,
} from '../scripts/slots.js';
import { play, cleanMove, memoryGames } from '../utils/solo-slots-game.js';
import slotsApi from '../utils/solo-slots.js';
import { memoryJackpot } from '../utils/slots-jackpot.js';
import { MAX_RETURN as BANK_MAX, GAMES, LIMITS } from '../utils/bank-rules.js';
import { mockBank } from '../tools/mock-bank.mjs';

const ME = 'u1';
// Reel stops that put these symbols on the payline.
const stopsFor = (machine, line) => line.map((symbol) => machine.strip.indexOf(symbol));
// A random() that stops the Hay Day's reels at `stops` and then the Golden Horse's at each of `free`.
function rigged(stops, free = []) {
  const queue = [...stops.map((s) => (s + 0.5) / MACHINE.strip.length), ...free.flat().map((s) => (s + 0.5) / BONUS.strip.length)];
  return () => {
    assert.ok(queue.length, 'the spin asked for more random numbers than the test gave it');
    return queue.shift();
  };
}
const BONUS_STOPS = [5, 6, 7]; // a Golden Horse tile below, on and above the line; the line itself pays nothing
const NOTHING = stopsFor(BONUS, ['jin', 'xi', 'fu']);
const freeSpins = (wins = []) => Array.from({ length: BONUS.spins }, (_, i) => (wins[i] ? stopsFor(BONUS, wins[i]) : NOTHING));

/* ---------- The machine ---------- */

test('the house always wins: the machine, bonus, jackpot and all, pays back less than is bet, but not much less', () => {
  const odds = rtp();
  assert.ok(odds.rtp >= RTP.min && odds.rtp <= RTP.max, `it pays back ${(odds.rtp * 100).toFixed(2)}%`);
  assert.ok(odds.rtp < 1, 'it has to lose money for its players');
  assert.ok(odds.hit > 0.2 && odds.hit < 0.45, `the line pays on ${(odds.hit * 100).toFixed(1)}% of spins`);
  assert.ok(odds.bonusEvery > 40 && odds.bonusEvery < 150, `a bonus every ${odds.bonusEvery.toFixed(0)} spins`);
  assert.ok(odds.bonusPays > 4 && odds.bonusPays < 12, `a bonus pays ${odds.bonusPays.toFixed(1)} bets on average`);
  assert.ok(Math.abs(odds.line + odds.bonusPays / odds.bonusEvery + odds.jackpot - odds.rtp) < 1e-12);
  // Even on a spin at a full pot, which is as good as this machine ever gets.
  assert.ok(odds.worst < 0.99, `at a full pot it pays back ${(odds.worst * 100).toFixed(2)}%`);
  assert.ok(odds.worst > odds.rtp);
});

test('the Grand Jackpot: a share of every bet, a chance that goes with the bet, and a pot that stops growing', () => {
  assert.ok(JACKPOT.rate > 0 && JACKPOT.rate <= 0.1);
  assert.ok(JACKPOT.seed > 0 && JACKPOT.seed < JACKPOT.max);
  for (const chip of CHIPS) assert.ok(Number.isInteger(Math.round(chip * JACKPOT.rate * 100)), 'shares are whole hundredths');
  assert.equal(jackpotChance(BETS.max), 1 / JACKPOT.odds);
  assert.equal(jackpotChance(10), 1 / JACKPOT.odds / 10, 'a tenth of the bet, a tenth of the chance');
  assert.equal(jackpotChance(0), 0);
  assert.equal(jackpotChance('100'), 0);
  // Rare: thousands of spins apart even at the biggest bet.
  assert.ok(JACKPOT.odds >= 1000);
});

test('the pot: shares go in, it stops at the top, and a win takes it all and starts it again', async () => {
  const jackpot = memoryJackpot();
  assert.equal(await jackpot.peek(), JACKPOT.seed);
  assert.equal(await jackpot.add(10), JACKPOT.seed + 1, '10% of 10');
  assert.equal(await jackpot.peek(), JACKPOT.seed + 1);
  assert.equal(await jackpot.add(100), JACKPOT.seed + 11);
  assert.equal(await jackpot.claim(), JACKPOT.seed + 11);
  assert.equal(await jackpot.peek(), JACKPOT.seed);
  await jackpot.giveBack(JACKPOT.seed + 11);
  assert.equal(await jackpot.peek(), JACKPOT.seed + 11, 'a win that never happened goes back');
  jackpot.pot.cents = JACKPOT.max * 100 - 50;
  assert.equal(await jackpot.add(100), JACKPOT.max, 'it never goes over the top');
  assert.equal(await jackpot.add(100), JACKPOT.max);
  assert.equal(await jackpot.claim(), JACKPOT.max);
});

test('the Hay Day and the Golden Horse are put together properly', () => {
  for (const machine of [MACHINE, BONUS]) {
    const key = machine.key;
    const symbols = Object.keys(machine.symbols);
    const paying = symbols.filter((s) => s !== machine.scatter);
    assert.deepEqual([...new Set(machine.strip)].sort(), [...symbols].sort(), `${key}: every symbol is on the strip, and nothing else`);
    assert.deepEqual(Object.keys(machine.three).sort(), [...paying].sort(), `${key}: three of anything pays`);
    for (const symbol of Object.keys(machine.two)) {
      assert.ok(paying.includes(symbol), `${key}: ${symbol}`);
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
  assert.ok(Number.isSafeInteger(BONUS.spins) && BONUS.spins > 0);
  assert.equal(BONUS.scatter, undefined, 'free spins don’t win more free spins');
});

test('bets are tens from 10 to 100, and the bank will pay the most a spin can win', () => {
  assert.deepEqual([0, 5, 10, 15, 100, 110, 10.5, '10', NaN].map(isBet), [false, false, true, false, true, false, false, false, false]);
  assert.ok(CHIPS.every(isBet));
  assert.ok(BETS.max <= LIMITS.maxStake);
  assert.ok(GAMES.includes('slots'));
  assert.equal(MAX_RETURN, MACHINE.three[MACHINE.jackpot] + BONUS.spins * BONUS.three[BONUS.jackpot] + JACKPOT.max / BETS.min);
  assert.equal(BANK_MAX.slots, MAX_RETURN, 'utils/bank-rules.js caps a spin at the most it can win');
});

test('what a payline pays', () => {
  assert.deepEqual(payFor(MACHINE, ['trusty', 'trusty', 'trusty']), { times: 50, kind: 'three', symbol: 'trusty' });
  assert.deepEqual(payFor(MACHINE, ['hay', 'apple', 'hay']), { times: 2, kind: 'two', symbol: 'hay' });
  assert.deepEqual(payFor(MACHINE, ['seven', 'seven', 'hay']), { times: 5, kind: 'two', symbol: 'seven' });
  assert.equal(payFor(MACHINE, ['pencil', 'pencil', 'shoe']).times, 0, 'two pencils pay nothing');
  assert.equal(payFor(MACHINE, ['hay', 'apple', 'carrot']).times, 0);
  assert.deepEqual(payFor(MACHINE, ['bonus', 'bonus', 'bonus']), { times: 0, kind: null, symbol: null }, 'the tiles win the bonus, not clicks');
  assert.deepEqual(payFor(BONUS, ['ma', 'ma', 'ma']), { times: 88, kind: 'three', symbol: 'ma' });
  assert.deepEqual(payFor(BONUS, ['fu', 'ma', 'ma']), { times: 8, kind: 'two', symbol: 'ma' });
  assert.equal(payFor(BONUS, ['fu', 'fu', 'xi']).times, 0);
  assert.equal(tierOf(MACHINE, payFor(MACHINE, ['trusty', 'trusty', 'trusty'])), 'jackpot');
  assert.equal(tierOf(MACHINE, payFor(MACHINE, ['seven', 'seven', 'seven'])), 'big');
  assert.equal(tierOf(MACHINE, payFor(MACHINE, ['hay', 'hay', 'hay'])), 'win');
  assert.equal(tierOf(MACHINE, payFor(MACHINE, ['hay', 'apple', 'carrot'])), null);
  assert.equal(tierOf(BONUS, payFor(BONUS, ['ma', 'ma', 'ma'])), 'jackpot');
});

test('spins stop somewhere on the strip, and the strip goes round', () => {
  for (const machine of [MACHINE, BONUS]) {
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

test('a Golden Horse tile showing on every reel wins the bonus, wherever it is in the window', () => {
  const tile = MACHINE.strip.indexOf('bonus');
  assert.deepEqual(scattersAt([tile, tile, tile]), [0, 0, 0]);
  assert.deepEqual(scattersAt([tile - 1, tile, tile + 1]), [1, 0, -1]);
  assert.deepEqual(scattersAt(BONUS_STOPS), [1, 0, -1]);
  assert.ok(triggers(BONUS_STOPS));
  assert.deepEqual(scattersAt([tile - 2, tile, tile]), [null, 0, 0], 'two reels away is off the screen');
  assert.ok(!triggers([tile - 2, tile, tile]));
  assert.ok(!triggers(stopsFor(MACHINE, ['trusty', 'trusty', 'trusty'])), 'the jackpot isn’t next to a tile');
  // The tiles are far enough apart that a reel never shows two.
  MACHINE.strip.forEach((_, i) => assert.ok([-1, 0, 1].filter((o) => symbolAt(MACHINE, i, o) === 'bonus').length <= 1));
});

test('a whole spin: the line, and every free spin when it wins the bonus', () => {
  const plain = spinMachine(rigged(stopsFor(MACHINE, ['carrot', 'carrot', 'carrot'])));
  assert.equal(plain.times, 7);
  assert.equal(plain.bonus, null);
  assert.equal(plain.total, 7);

  const free = freeSpins([['ma', 'ma', 'ma'], null, ['jin', 'jin', 'jin']]);
  const won = spinMachine(rigged([5, 5, 7], free));
  assert.deepEqual(won.line, ['hay', 'hay', 'carrot']);
  assert.equal(won.times, 2, 'the line still pays');
  assert.equal(won.bonus.spins.length, BONUS.spins);
  assert.deepEqual(won.bonus.spins.map((s) => s.times), [88, 0, 5, 0, 0, 0, 0, 0]);
  assert.deepEqual(won.bonus.spins[0], { stops: free[0], line: ['ma', 'ma', 'ma'], times: 88, kind: 'three', symbol: 'ma' });
  assert.equal(won.bonus.times, 93);
  assert.equal(won.total, 95);
});

test('the page draws its paytable from the module and has no machine of its own', () => {
  const page = fs.readFileSync(new URL('../pages/games/slots.html', import.meta.url), 'utf8');
  assert.match(page, /from '\/scripts\/slots\.js'/);
  assert.doesNotMatch(page, /Math\.random\(\)[^\n]*strip\.length/, 'the page never picks where a reel stops');
});

/* ---------- The game ---------- */

test('only real spins get through', () => {
  assert.deepEqual(cleanMove({ do: 'spin', amount: 50 }), { do: 'spin', amount: 50 });
  assert.deepEqual(cleanMove({ do: 'spin', amount: 10, payout: 9999, bonus: true }), { do: 'spin', amount: 10 });
  for (const bad of [
    null, 'spin', {}, { do: 'roll', amount: 10 }, { do: 'spin' }, { do: 'spin', amount: 500 }, { do: 'spin', amount: 15 },
    { do: 'spin', amount: '10' }, { do: 'spin', amount: { $gt: 0 } }, { do: { $ne: null }, amount: 10 },
  ]) assert.equal(cleanMove(bad), null, JSON.stringify(bad));
});

function game({ clicks = 1000 } = {}) {
  const bank = mockBank({ startingClicks: clicks, delay: 0 });
  const store = memoryGames();
  let ids = 0;
  const jackpot = memoryJackpot();
  // luck: the Grand Jackpot's roll. Never, unless a test says so.
  const deps = { ...store, bank, jackpot, now: () => 1000, random: Math.random, luck: () => 0.999999, newId: () => String(++ids).padStart(16, '0') };
  return {
    bank, store, deps, jackpot,
    // line: the Hay Day's payline, or its stops; free: the Golden Horse's stops, when those win the bonus.
    spin(amount, line, free) {
      if (line) deps.random = rigged(typeof line[0] === 'number' ? line : stopsFor(MACHINE, line), free);
      return play(deps, ME, { do: 'spin', amount });
    },
    look: () => play(deps, ME, null),
    clicks: () => bank.account(ME).clicks,
    open: () => bank.account(ME).open.size,
  };
}

test('a spin: a loss takes the bet, a win pays the paytable', async () => {
  const g = game();
  assert.deepEqual(await g.look(), { last: null, spins: 0, bets: BETS, bank: null, jackpot: JACKPOT.seed });
  let shown = await g.spin(50, ['hay', 'apple', 'carrot']);
  assert.deepEqual(shown.bank, { clicks: 950, net: -50 });
  assert.equal(shown.last.payout, 0);
  assert.equal(shown.last.bonus, null);
  assert.deepEqual(shown.last.line, ['hay', 'apple', 'carrot']);
  shown = await g.spin(50, ['carrot', 'carrot', 'carrot']);
  assert.deepEqual(shown.bank, { clicks: 1250, net: 250 });
  assert.equal(shown.last.payout, 350);
  assert.equal(shown.last.times, 7);
  assert.equal(shown.spins, 2);
  assert.equal(g.open(), 0);
  assert.ok(isStops(MACHINE, shown.last.stops));
  assert.deepEqual(lineOf(MACHINE, shown.last.stops), shown.last.line);
});

test('a spin that wins the bonus is one bet and one payout, free spins and all', async () => {
  const g = game();
  const shown = await g.spin(100, [5, 5, 7], freeSpins([null, ['long', 'long', 'long'], null, null, ['ma', 'ma', 'fu']]));
  assert.equal(shown.last.times, 2);
  assert.equal(shown.last.bonus.times, 46);
  assert.equal(shown.last.total, 48);
  assert.equal(shown.last.payout, 4800);
  assert.deepEqual(shown.bank, { clicks: 1000 - 100 + 4800, net: 4700 });
  assert.equal(g.open(), 0);
  assert.equal(g.bank.status(ME).month.slots, 4700);
});

test('the bank pays the most a spin can possibly win', async () => {
  const g = game();
  const shown = await g.spin(100, BONUS_STOPS, freeSpins(Array(BONUS.spins).fill(['ma', 'ma', 'ma'])));
  assert.equal(shown.last.total, BONUS.spins * 88);
  assert.equal(g.clicks(), 1000 - 100 + 100 * BONUS.spins * 88);
  // And the Hay Day's top prize and a full Grand Jackpot on top of it, on the smallest bet.
  const bet = { userId: ME, betId: 'f'.repeat(16), amount: 10, game: 'slots', solo: true };
  g.bank.account(ME).net = 0;
  await g.bank.stake(bet);
  await g.bank.settle([{ userId: ME, betId: bet.betId, payout: 10 * MAX_RETURN }]);
  assert.equal(g.open(), 0, 'paid, not refused');
});

test('the Grand Jackpot: every spin feeds it, and the lucky one takes the lot', async () => {
  const g = game();
  let shown = await g.spin(100, ['hay', 'apple', 'carrot']);
  assert.equal(shown.jackpot, JACKPOT.seed + 10, '10% of 100');
  assert.equal(shown.last.jackpot, 0);
  shown = await g.spin(50, ['carrot', 'carrot', 'carrot']);
  assert.equal(shown.jackpot, JACKPOT.seed + 15);
  // The roll goes with the bet: the same luck wins at 100 and not at 50.
  g.deps.luck = () => 1 / JACKPOT.odds - 1e-9;
  shown = await g.spin(50, ['hay', 'apple', 'carrot']);
  assert.equal(shown.last.jackpot, 0);
  const before = g.clicks();
  shown = await g.spin(100, ['hay', 'hay', 'hay']);
  assert.equal(shown.last.jackpot, JACKPOT.seed + 20, 'everything that was in it');
  assert.equal(shown.last.payout, 500 + JACKPOT.seed + 20, 'with what the line paid');
  assert.equal(g.clicks(), before - 100 + 500 + JACKPOT.seed + 20);
  assert.equal(shown.jackpot, JACKPOT.seed + 10, 'a new pot, with this spin’s share already in it');
  assert.equal(g.open(), 0);
});

test('a Grand Jackpot is paid in full and doesn’t count towards the day’s limit', async () => {
  const g = game();
  g.jackpot.pot.cents = JACKPOT.max * 100;
  g.deps.luck = () => 0;
  let shown = await g.spin(10, ['carrot', 'carrot', 'carrot']);
  assert.equal(shown.last.jackpot, JACKPOT.max);
  assert.equal(g.clicks(), 1000 - 10 + 70 + JACKPOT.max);
  assert.deepEqual(shown.bank, { clicks: 1060 + JACKPOT.max, net: 60 }, 'only the line’s win is on the day’s total');
  assert.equal(g.bank.status(ME).month.slots, 60 + JACKPOT.max, 'the house still paid it');
  // So the winner can carry on betting.
  g.deps.luck = () => 0.999999;
  shown = await g.spin(100, ['hay', 'apple', 'carrot']);
  assert.equal(shown.error, undefined);
  assert.equal(shown.spins, 2);
  // Nobody else gets to call part of a payout a windfall.
  const bet = { userId: ME, betId: 'e'.repeat(16), amount: 100, game: 'blackjack' };
  await g.bank.stake(bet);
  const before = g.bank.account(ME).net;
  await g.bank.settle([{ userId: ME, betId: bet.betId, payout: 300, windfall: 300 }]);
  assert.equal(g.bank.account(ME).net, before + 300);
});

test('a jackpot won by a spin that lost the race goes back in the pot', async () => {
  const g = game();
  await g.spin(100, ['hay', 'apple', 'carrot']);
  const stale = await g.store.load(ME);
  await g.spin(100, ['hay', 'apple', 'carrot']); // another tab spins
  const load = g.deps.load;
  g.deps.load = async () => { g.deps.load = load; return structuredClone(stale); };
  g.deps.luck = () => 0;
  const shown = await g.spin(100, ['hay', 'apple', 'carrot']);
  assert.match(shown.error, /another tab/);
  assert.equal(shown.jackpot, JACKPOT.seed + 20, 'still there, with both real spins’ shares');
  assert.equal(g.clicks(), 800);
});

test('a pot that can’t be reached never stops a spin', async () => {
  const g = game();
  const down = async () => { throw new Error('the pot is down'); };
  g.deps.jackpot = { peek: down, add: down, claim: down, giveBack: down };
  g.deps.luck = () => 0;
  const error = console.error;
  console.error = () => {};
  try {
    const shown = await g.spin(10, ['carrot', 'carrot', 'carrot']);
    assert.equal(shown.last.payout, 70);
    assert.equal(shown.last.jackpot, 0);
    assert.equal(shown.jackpot, null);
    assert.equal(g.clicks(), 1060);
  } finally {
    console.error = error;
  }
});

test('a spin the bank turns down doesn’t spin', async () => {
  const g = game({ clicks: 40 });
  const shown = await g.spin(50, ['trusty', 'trusty', 'trusty']);
  assert.match(shown.error, /only have 40/);
  assert.equal(shown.spins, 0);
  assert.equal(shown.last, null);
  assert.equal(g.clicks(), 40);
});

test('a payout that didn’t get through is paid on the next visit, once', async () => {
  const g = game();
  const real = g.bank.settle;
  g.deps.bank = { ...g.bank, settle: async () => { throw new Error('the bank is down'); } };
  await assert.rejects(g.spin(100, ['seven', 'seven', 'seven']));
  assert.equal(g.clicks(), 900);
  g.deps.bank = { ...g.bank, settle: real };
  const shown = await g.look();
  assert.deepEqual(shown.bank, { clicks: 4900, net: 3900 });
  await g.look();
  assert.equal(g.clicks(), 4900, 'paid once');
});

test('two tabs: the spin that lost the race gets its bet back', async () => {
  const g = game();
  await g.spin(10, ['hay', 'apple', 'carrot']);
  const stale = await g.store.load(ME);
  await g.spin(10, ['hay', 'apple', 'carrot']); // another tab spins
  const load = g.deps.load;
  g.deps.load = async () => { g.deps.load = load; return structuredClone(stale); };
  const shown = await g.spin(100, ['trusty', 'trusty', 'trusty']);
  assert.match(shown.error, /another tab/);
  assert.equal(g.clicks(), 980, 'the bet came back, and the jackpot never happened');
  assert.equal(g.open(), 0);
  assert.equal(shown.spins, 2);
});

test('a bet waiting on its spin is never given back by the bank', async () => {
  const g = game();
  g.deps.bank = { ...g.bank, settle: async () => { throw new Error('the bank is down'); } };
  await assert.rejects(g.spin(10));
  assert.equal(g.bank.account(ME).open.values().next().value.solo, true);
});

test('over many spins, the players lose', async () => {
  const g = game({ clicks: 10_000_000 });
  // A seeded generator, so this never flakes.
  let seed = 20261115;
  g.deps.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  delete g.deps.luck; // the jackpot's real roll
  let bet = 0;
  let back = 0;
  let bonuses = 0;
  for (let i = 0; i < 6000; i++) {
    g.bank.account(ME).net = 0; // no daily limits here
    const shown = await play(g.deps, ME, { do: 'spin', amount: 10 });
    bet += 10;
    back += shown.last.payout;
    if (shown.last.bonus) bonuses += 1;
  }
  assert.ok(back < bet, `${back} back on ${bet} bet`);
  assert.ok(bonuses > 30, `${bonuses} bonuses in 6,000 spins`);
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
  assert.equal((await call({ method: 'POST', body: { do: 'spin', amount: 10 } })).statusCode, 401);
  const user = { userId: 'u1', username: 'carson' };
  assert.equal((await call({ method: 'POST', user, body: { do: 'spin', amount: { $gt: 0 } } })).statusCode, 400);
  assert.equal((await call({ method: 'DELETE', user })).statusCode, 405);
});
