// Trusty Craps: the rules (scripts/craps.js) and the game for clicks (utils/solo-craps-game.js), with games kept in
// memory and the in-memory bank from tools/mock-bank.mjs. The last test plays with the real MongoDB storage and
// bank, so it only runs with BANK_TEST_MONGO_URI set (see tests/bank.test.js).
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
import { SPOTS, POINTS, BETS, MAX_RETURN, canBet, oddsMax, newTable, roll, winReturn, isBet } from '../scripts/craps.js';
import { play, cleanMove, memoryGames } from '../utils/solo-craps-game.js';
import crapsApi from '../utils/solo-craps.js';
import { mongoGames } from '../utils/solo-store.js';
import { stake, settle, refundStale } from '../utils/bank.js';
import { MAX_RETURN as BANK_MAX } from '../utils/bank-rules.js';
import { mockBank } from '../tools/mock-bank.mjs';

const ME = 'u1';
const bet = (amount, id = 'b') => ({ id, amount });
function tableWith(point, bets) {
  return { point, bets: Object.fromEntries(Object.entries(bets).map(([spot, amount]) => [spot, bet(amount, spot)])) };
}
const results = (decided) => Object.fromEntries(decided.map((d) => [d.spot, [d.result, d.payout]]));

/* ---------- The rules ---------- */

test('come-out roll: naturals, craps, and the point', () => {
  for (const dice of [[3, 4], [5, 6]]) {
    const t = tableWith(null, { pass: 100, dontPass: 100 });
    assert.deepEqual(results(roll(t, dice)), { pass: ['win', 200], dontPass: ['lose', 0] }, String(dice));
    assert.equal(t.point, null);
  }
  for (const [dice, dont] of [[[1, 1], ['win', 200]], [[1, 2], ['win', 200]], [[6, 6], ['push', 100]]]) {
    const t = tableWith(null, { pass: 100, dontPass: 100 });
    assert.deepEqual(results(roll(t, dice)), { pass: ['lose', 0], dontPass: dont }, String(dice));
    assert.equal(t.point, null);
  }
  const t = tableWith(null, { pass: 100, dontPass: 50 });
  assert.deepEqual(roll(t, [2, 4]), [], 'a point decides nothing');
  assert.equal(t.point, 6);
  assert.deepEqual(Object.keys(t.bets), ['pass', 'dontPass'], 'line bets ride');
});

test('with a point: hitting it, sevening out, and everything else', () => {
  let t = tableWith(6, { pass: 100, dontPass: 50, odds: 200 });
  assert.deepEqual(results(roll(t, [4, 2])), { pass: ['win', 200], dontPass: ['lose', 0], odds: ['win', 440] }, '6 to 5 odds');
  assert.equal(t.point, null);
  t = tableWith(6, { pass: 100, dontPass: 50, odds: 200 });
  assert.deepEqual(results(roll(t, [3, 4])), { pass: ['lose', 0], dontPass: ['win', 100], odds: ['lose', 0] });
  assert.equal(t.point, null);
  for (const dice of [[1, 1], [5, 6], [6, 6], [4, 4]]) {
    t = tableWith(6, { pass: 100, odds: 100 });
    assert.deepEqual(roll(t, dice), [], `${dice}: nothing happens`);
    assert.equal(t.point, 6);
  }
  t = tableWith(4, { odds: 100 });
  assert.equal(roll(t, [2, 2])[0].payout, 300, '2 to 1 on 4');
  t = tableWith(9, { odds: 100 });
  assert.equal(roll(t, [4, 5])[0].payout, 250, '3 to 2 on 9');
});

test('one-roll bets win or lose on every roll', () => {
  const field = { 2: 30, 3: 20, 4: 20, 5: 0, 6: 0, 7: 0, 8: 0, 9: 20, 10: 20, 11: 20, 12: 40 };
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      const sum = a + b;
      for (const point of [null, 6]) {
        const t = tableWith(point, { field: 10, seven: 10, craps: 10 });
        const r = results(roll(t, [a, b]));
        assert.equal(r.field[1], field[sum], `field on ${sum}`);
        assert.equal(r.seven[1], sum === 7 ? 50 : 0, `any seven on ${sum}`);
        assert.equal(r.craps[1], [2, 3, 12].includes(sum) ? 80 : 0, `any craps on ${sum}`);
        assert.deepEqual(t.bets, {}, 'they never stay up');
      }
    }
  }
});

test('which bets can go down when', () => {
  const comeOut = newTable();
  for (const spot of ['pass', 'dontPass', 'field', 'seven', 'craps']) assert.equal(canBet(comeOut, spot), true, spot);
  assert.equal(canBet(comeOut, 'odds'), false, 'no odds without a point');
  assert.equal(canBet(tableWith(null, { pass: 10 }), 'pass'), false, 'already down');
  const point = tableWith(8, { pass: 50 });
  assert.equal(canBet(point, 'pass'), false, 'no line bets once there’s a point');
  assert.equal(canBet(point, 'dontPass'), false);
  assert.equal(canBet(point, 'odds'), true);
  assert.equal(canBet(tableWith(8, { pass: 50, odds: 100 }), 'odds'), false);
  assert.equal(canBet(tableWith(8, { dontPass: 50 }), 'odds'), false, 'odds go behind the Pass Line only');
  assert.equal(canBet(comeOut, 'hardways'), false);
  assert.equal(oddsMax(100), 200);
  assert.equal(oddsMax(500), BETS.max);
});

test('every bet pays whole clicks, within what the bank will pay out', () => {
  assert.equal(BANK_MAX.craps, MAX_RETURN);
  for (let amount = BETS.min; amount <= BETS.max; amount += BETS.step) {
    for (const spot of SPOTS) {
      for (const point of POINTS) {
        for (let sum = 2; sum <= 12; sum++) {
          const back = winReturn(spot, amount, sum, point);
          assert.ok(Number.isInteger(back), `${spot} ${amount} on ${sum}/${point}: ${back}`);
          assert.ok(back <= amount * MAX_RETURN, `${spot} ${amount} on ${sum}/${point}: ${back}`);
        }
      }
    }
  }
  assert.equal(isBet(15), false);
  assert.equal(isBet(510), false);
});

test('only real moves get through', () => {
  assert.deepEqual(cleanMove({ do: 'roll', bets: { pass: 10, field: 500 } }), { do: 'roll', bets: { pass: 10, field: 500 } });
  assert.deepEqual(cleanMove({ do: 'roll' }), { do: 'roll', bets: {} });
  for (const bets of [{ pass: 5 }, { pass: '10' }, { pass: { $gt: 0 } }, { hardways: 10 }, [10], 'pass', { pass: 1e9 }]) {
    assert.equal(cleanMove({ do: 'roll', bets }), null, JSON.stringify(bets));
  }
  for (const junk of [null, 'roll', [], {}, { do: 'win' }, { do: { $ne: null } }]) assert.equal(cleanMove(junk), null);
});

/* ---------- The game for clicks ---------- */

// random() values that roll these dice, in order.
const faces = (...dice) => dice.flat().map((f) => (f - 0.5) / 6);

function game({ clicks = 1000, dice = [] } = {}) {
  let ids = 0;
  const rolls = faces(...dice);
  const store = memoryGames();
  const bank = mockBank({ startingClicks: clicks, delay: 0 });
  const deps = {
    ...store,
    bank,
    now: () => 1_000_000,
    random: () => (rolls.length ? rolls.shift() : Math.random()),
    newId: () => (++ids).toString(16).padStart(16, '0'),
  };
  return {
    deps,
    bank,
    store,
    roll: (bets, more) => {
      if (more) rolls.push(...faces(more));
      return play(deps, ME, cleanMove({ do: 'roll', bets }));
    },
    look: () => play(deps, ME, null),
    clicks: () => bank.status(ME).clicks,
    open: () => bank.account(ME).open.size,
  };
}

test('a game: the point, the odds, and the payout', async () => {
  const g = game();
  let shown = await g.roll({ pass: 100, field: 10 }, [2, 3]); // 5: the point; field loses
  assert.equal(shown.table.point, 5);
  assert.deepEqual(shown.table.bets, { pass: 100 });
  assert.deepEqual(shown.last.dice, [2, 3]);
  assert.deepEqual(shown.last.decided, [{ spot: 'field', amount: 10, result: 'lose', payout: 0 }]);
  assert.equal(g.clicks(), 890);
  assert.deepEqual(shown.bank, { clicks: 890, net: -110 });
  assert.equal(g.open(), 1, 'the Pass Line rides');

  shown = await g.roll({ pass: 10 });
  assert.match(shown.error, /come-out/);
  assert.equal(g.clicks(), 890, 'nothing staked, nothing rolled');
  shown = await g.roll({ odds: 300 });
  assert.match(shown.error, /2 times/);

  shown = await g.roll({ odds: 200 }, [6, 6]); // 12: nothing happens
  assert.equal(shown.table.point, 5);
  assert.deepEqual(shown.table.bets, { pass: 100, odds: 200 });
  assert.equal(g.clicks(), 690);
  shown = await g.roll({ odds: 10 });
  assert.match(shown.error, /already down/);

  shown = await g.roll({}, [4, 1]); // hit the point
  assert.equal(shown.table.point, null);
  assert.deepEqual(shown.table.bets, {});
  assert.equal(g.clicks(), 690 + 200 + 500, 'the line pays 1 to 1, the odds 3 to 2');
  assert.equal(g.open(), 0);
  assert.deepEqual(shown.history, [5, 12, 5]);
  assert.equal(shown.rolls, 3);
  assert.equal(g.bank.status(ME).month.craps, 1390 - 1000);
});

test('no bets, no roll', async () => {
  const g = game();
  const shown = await g.roll({});
  assert.match(shown.error, /bet down first/);
  assert.equal(shown.rolls, 0);
});

test('a bet the bank turns down sends the others back, and nothing is rolled', async () => {
  const g = game({ clicks: 150 });
  const shown = await g.roll({ pass: 100, field: 100 }, [3, 4]);
  assert.match(shown.error, /only have 50/);
  assert.equal(g.clicks(), 150);
  assert.equal(g.open(), 0);
  assert.equal(shown.rolls, 0);
  assert.deepEqual(shown.table.bets, {});
});

test('a payout that didn’t get through is paid on the next visit, once', async () => {
  const g = game();
  const real = g.bank.settle;
  g.deps.bank = { ...g.bank, settle: async () => { throw new Error('the bank is down'); } };
  await assert.rejects(g.roll({ seven: 100 }, [3, 4]));
  assert.equal(g.clicks(), 900);
  g.deps.bank = { ...g.bank, settle: real };
  const shown = await g.look();
  assert.deepEqual(shown.bank, { clicks: 1400, net: 400 });
  await g.look();
  assert.equal(g.clicks(), 1400, 'paid once');
  assert.equal(shown.last.decided[0].payout, 500);
});

test('two tabs: the roll that lost the race gets its bets back', async () => {
  const g = game();
  await g.roll({ pass: 50 }, [3, 3]); // point 6
  const stale = await g.store.load(ME);
  await g.roll({}, [2, 2]); // another tab rolls a 4
  // This tab rolls from the table as it was before that.
  const load = g.deps.load;
  g.deps.load = async () => { g.deps.load = load; return structuredClone(stale); };
  const shown = await g.roll({ odds: 100, field: 10 }, [6, 5]);
  assert.match(shown.error, /another tab/);
  assert.equal(g.clicks(), 950, 'the odds and the field came back');
  assert.equal(g.open(), 1);
  assert.equal(shown.rolls, 2);
});

test('bets riding on the table are never given back by the bank', async () => {
  const g = game();
  await g.roll({ dontPass: 100 }, [4, 4]);
  assert.equal(g.bank.account(ME).open.values().next().value.solo, true);
});

function call({ method = 'GET', body, user } = {}) {
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
  const cookie = user ? `authToken=${jwt.sign(user, process.env.JWT_SECRET)}` : undefined;
  return Promise.resolve(crapsApi({ method, query: { action: 'craps' }, headers: { cookie }, body }, res)).then(() => res);
}

test('the endpoint turns away strangers and junk before touching the database', async () => {
  assert.equal((await call()).statusCode, 401);
  assert.equal((await call({ method: 'POST', body: { do: 'roll', bets: { pass: 10 } } })).statusCode, 401);
  const user = { userId: 'u1', username: 'carson' };
  assert.equal((await call({ method: 'POST', user, body: { do: 'roll', bets: { pass: { $gt: 0 } } } })).statusCode, 400);
  assert.equal((await call({ method: 'DELETE', user })).statusCode, 405);
});

const uri = process.env.BANK_TEST_MONGO_URI;
test('with MongoDB: rolls, payouts, and two tabs at once', { skip: uri ? false : 'set BANK_TEST_MONGO_URI to a throwaway MongoDB to run' }, async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(`craps_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  try {
    const clicks = db.collection('click_game');
    await clicks.insertOne({ userId: ME, username: 'carson', clicks: 1000 });
    let ids = 0;
    const rolls = faces([3, 3], [4, 4], [3, 3]);
    const deps = {
      ...mongoGames(db.collection('craps_solo')),
      bank: { stake: (op) => stake(clicks, op), settle: (bets) => settle(clicks, bets) },
      now: Date.now,
      random: () => (rolls.length ? rolls.shift() : Math.random()),
      newId: () => (++ids).toString(16).padStart(16, '0'),
    };
    // Two first rolls at once: one gets the table, the other's bets come straight back.
    const both = await Promise.all([
      play(deps, ME, { do: 'roll', bets: { pass: 100 } }),
      play(deps, ME, { do: 'roll', bets: { pass: 100 } }),
    ]);
    assert.equal(both.filter((x) => x.error).length, 1, JSON.stringify(both.map((x) => x.error)));
    assert.equal((await clicks.findOne({ userId: ME })).clicks, 900);
    assert.equal(await refundStale(clicks, ME, new Date(Date.now() + 5 * 3600e3)), 0, 'walking away doesn’t get the bet back');
    let shown = await play(deps, ME, null);
    const point = shown.table.point;
    // Roll with odds until the point or a 7.
    shown = await play(deps, ME, { do: 'roll', bets: { odds: 100 } });
    for (let i = 0; shown.table.point != null && i < 200; i++) shown = await play(deps, ME, { do: 'roll', bets: {} });
    const after = await clicks.findOne({ userId: ME });
    assert.deepEqual(after.bank.open, {}, 'everything settled');
    const won = shown.history.at(-1) === point;
    assert.equal(after.clicks, won ? 800 + 200 + winReturn('odds', 100, point, point) : 800);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
