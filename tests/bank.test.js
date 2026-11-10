// The click bank (utils/bank.js). The request checks always run; the money itself needs a real MongoDB, so those
// tests only run with BANK_TEST_MONGO_URI set to a throwaway one, e.g. from mongodb-memory-server:
//   npm i --prefix /tmp/mms mongodb-memory-server && BANK_TEST_MONGO_URI=... node --test tests/bank.test.js
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import bankApi, { stake, settle, settlePot, refundStale, status, signedOp, dayOf, LIMITS, STALE_MS } from '../utils/bank.js';
import { signPayload } from '../utils/fever-ticket.js';

const SECRET = 'a-test-secret-that-is-long-enough-1234';
const sign = async (op, ts = Date.now()) => {
  const payload = JSON.stringify({ ...op, ts });
  return { payload, sig: await signPayload(payload, SECRET) };
};
const id = (n) => n.toString(16).padStart(16, '0');

test('only signed, fresh, sensible requests get through', async () => {
  const good = { op: 'stake', userId: 'u1', betId: id(1), amount: 100, game: 'blackjack' };
  assert.deepEqual(await signedOp(await sign(good), SECRET), good);
  assert.equal(await signedOp(await sign(good), `${SECRET}x`), null, 'another secret');
  assert.equal(await signedOp(await sign(good, Date.now() - 120000), SECRET), null, 'too old');
  const forged = await sign(good);
  forged.payload = forged.payload.replace('100', '1');
  assert.equal(await signedOp(forged, SECRET), null, 'changed after signing');
  for (const junk of [null, {}, { payload: 1, sig: 2 }, { payload: '{}', sig: '' }]) assert.equal(await signedOp(junk, SECRET), null);

  for (const bad of [
    { ...good, amount: 0 }, { ...good, amount: LIMITS.maxStake + 1 }, { ...good, amount: 2.5 }, { ...good, amount: '100' },
    { ...good, game: 'poker' }, { ...good, userId: { $ne: null } }, { ...good, betId: 'abc.def' }, { ...good, betId: 'x'.repeat(16) },
    { op: 'settle', bets: [] }, { op: 'settle', bets: [{ userId: 'u1', betId: id(1), payout: -1 }] },
    { op: 'pot', potId: id(9), stakes: [{ userId: 'u1', betId: id(1) }, { userId: 'u1', betId: id(2) }], winners: ['u1'] },
    { op: 'pot', potId: id(9), stakes: [{ userId: 'u1', betId: id(1) }], winners: ['u2'] },
    { op: 'mint', userId: 'u1', amount: 1000 },
  ]) {
    assert.equal(await signedOp(await sign(bad), SECRET), null, JSON.stringify(bad));
  }
});

function call(handler, { method = 'GET', body } = {}) {
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
  return Promise.resolve(handler({ method, query: { action: 'bank' }, headers: {}, body }, res)).then(() => res);
}

test('the bank endpoint turns away strangers before touching the database', async () => {
  process.env.FEVER_SECRET = SECRET;
  assert.equal((await call(bankApi)).statusCode, 401, 'GET needs a login');
  const unsigned = { payload: JSON.stringify({ op: 'stake', userId: 'u1', betId: id(1), amount: 100, game: 'fever', ts: Date.now() }), sig: 'nope' };
  assert.equal((await call(bankApi, { method: 'POST', body: unsigned })).statusCode, 403);
  delete process.env.FEVER_SECRET;
  assert.equal((await call(bankApi, { method: 'POST', body: await sign({ op: 'stake', userId: 'u1', betId: id(1), amount: 100, game: 'fever' }) })).statusCode, 403, 'no secret, no bank');
});

/* ---------- With a real MongoDB ---------- */

const uri = process.env.BANK_TEST_MONGO_URI;
const needsMongo = { skip: uri ? false : 'set BANK_TEST_MONGO_URI to a throwaway MongoDB to run' };

async function withDb(fn) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(`bank_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  try {
    await fn(db.collection('click_game'), db.collection('fever_pots'));
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}
const clicksOf = async (col, userId) => (await col.findOne({ userId })).clicks;

test('bets come off your clicks once, and pay out once', needsMongo, () => withDb(async (col) => {
  await col.insertOne({ userId: 'u1', username: 'carson', clicks: 1000 });
  assert.deepEqual(await stake(col, { userId: 'u1', betId: id(1), amount: 100, game: 'blackjack' }), { ok: true, clicks: 900, net: -100 });
  assert.equal((await stake(col, { userId: 'u1', betId: id(1), amount: 100, game: 'blackjack' })).ok, true, 'a retry');
  assert.equal(await clicksOf(col, 'u1'), 900, '…doesn’t charge twice');
  assert.match((await stake(col, { userId: 'u1', betId: id(2), amount: 901, game: 'blackjack' })).error, /only have 900/);
  assert.match((await stake(col, { userId: 'nobody', betId: id(3), amount: 10, game: 'blackjack' })).error, /don’t have any clicks/);

  await settle(col, [{ userId: 'u1', betId: id(1), payout: 301 }]);
  assert.equal(await clicksOf(col, 'u1'), 900, 'more than blackjack can pay is refused');
  const paid = await settle(col, [{ userId: 'u1', betId: id(1), payout: 250 }]);
  assert.deepEqual(paid.balances.u1, { clicks: 1150, net: 150 });
  await settle(col, [{ userId: 'u1', betId: id(1), payout: 250 }]);
  assert.equal(await clicksOf(col, 'u1'), 1150, 'paid once');
  const mine = await status(col, 'u1');
  assert.equal(mine.net, 150);
  assert.equal(mine.month.blackjack, 150);
}));

test('two tabs can’t spend the same clicks', needsMongo, () => withDb(async (col) => {
  await col.insertOne({ userId: 'u1', clicks: 1000 });
  const tries = await Promise.all(Array.from({ length: 25 }, (_, i) => stake(col, { userId: 'u1', betId: id(100 + i), amount: 100, game: 'blackjack' })));
  assert.equal(tries.filter((t) => t.ok).length, 10);
  assert.equal(await clicksOf(col, 'u1'), 0);
}));

test('daily limits, and a new day starts from zero', needsMongo, () => withDb(async (col) => {
  await col.insertOne({ userId: 'u1', clicks: 100000 });
  const morning = new Date('2026-11-10T15:00:00Z');
  for (let i = 0; i < 9; i++) await stake(col, { userId: 'u1', betId: id(i + 1), amount: 500, game: 'blackjack' }, morning);
  await stake(col, { userId: 'u1', betId: id(10), amount: 300, game: 'blackjack' }, morning); // 4,800 down, all still open
  assert.match((await stake(col, { userId: 'u1', betId: id(11), amount: 500, game: 'blackjack' }, morning)).error, /more than 5,000 clicks down/);
  assert.equal((await stake(col, { userId: 'u1', betId: id(12), amount: 200, game: 'blackjack' }, morning)).ok, true, 'up to the limit is fine');
  // Win them all back and then some: once you're 5,000 up, no more bets today.
  const bets = Array.from({ length: 10 }, (_, i) => ({ userId: 'u1', betId: id(i + 1), payout: i < 9 ? 1500 : 900 }));
  await settle(col, [...bets, { userId: 'u1', betId: id(12), payout: 600 }], morning);
  assert.equal((await status(col, 'u1', morning)).net, 9 * 1000 + 600 + 400);
  assert.match((await stake(col, { userId: 'u1', betId: id(20), amount: 10, game: 'blackjack' }, morning)).error, /daily limit/);
  // Midnight Eastern is 05:00 UTC in November.
  const tomorrow = new Date('2026-11-11T05:30:00Z');
  assert.notEqual(dayOf(morning), dayOf(tomorrow));
  assert.equal((await stake(col, { userId: 'u1', betId: id(21), amount: 10, game: 'blackjack' }, tomorrow)).ok, true);
  assert.equal((await status(col, 'u1', tomorrow)).net, -10);
}));

test('a bet from before midnight counts toward the day it was made', needsMongo, () => withDb(async (col) => {
  await col.insertOne({ userId: 'u1', clicks: 1000 });
  await stake(col, { userId: 'u1', betId: id(1), amount: 100, game: 'blackjack' }, new Date('2026-11-11T04:59:00Z'));
  await settle(col, [{ userId: 'u1', betId: id(1), payout: 200 }], new Date('2026-11-11T05:01:00Z'));
  assert.equal(await clicksOf(col, 'u1'), 1100);
  assert.equal((await status(col, 'u1', new Date('2026-11-11T05:02:00Z'))).net, 100, 'today only gets the win, not the whole payout');
}));

test('a Fever pot: the bank adds it up, pays the winner once, and refunds a called-off game', needsMongo, () => withDb(async (col, pots) => {
  await col.insertMany([{ userId: 'a', clicks: 500 }, { userId: 'b', clicks: 500 }, { userId: 'c', clicks: 500 }]);
  for (const [i, u] of ['a', 'b', 'c'].entries()) await stake(col, { userId: u, betId: id(i + 1), amount: 100, game: 'fever' });
  const stakes = ['a', 'b', 'c'].map((u, i) => ({ userId: u, betId: id(i + 1) }));
  const won = await settlePot(col, pots, { potId: id(50), stakes, winners: ['b'] });
  assert.equal(won.total, 300);
  assert.deepEqual([await clicksOf(col, 'a'), await clicksOf(col, 'b'), await clicksOf(col, 'c')], [400, 700, 400]);
  await settlePot(col, pots, { potId: id(50), stakes, winners: ['a'] }); // a retry, even a confused one
  assert.deepEqual([await clicksOf(col, 'a'), await clicksOf(col, 'b'), await clicksOf(col, 'c')], [400, 700, 400], 'paid once, as first written down');

  // Settling a pot that stopped halfway: the losers were done, the winner wasn't.
  for (const [i, u] of ['a', 'b'].entries()) await stake(col, { userId: u, betId: id(i + 10), amount: 50, game: 'fever' });
  const half = [{ userId: 'a', betId: id(10) }, { userId: 'b', betId: id(11) }];
  await pots.insertOne({ _id: id(60), total: 100, payouts: [{ userId: 'a', betId: id(10), amount: 50, payout: 100 }, { userId: 'b', betId: id(11), amount: 50, payout: 0 }] });
  await settle(col, [{ userId: 'b', betId: id(11), payout: 0 }]);
  await settlePot(col, pots, { potId: id(60), stakes: half, winners: ['a'] });
  assert.deepEqual([await clicksOf(col, 'a'), await clicksOf(col, 'b')], [450, 650]);

  // Called off: everyone wins, so everyone gets their own stake back.
  for (const [i, u] of ['a', 'c'].entries()) await stake(col, { userId: u, betId: id(i + 20), amount: 100, game: 'fever' });
  await settlePot(col, pots, { potId: id(70), stakes: [{ userId: 'a', betId: id(20) }, { userId: 'c', betId: id(21) }], winners: ['a', 'c'] });
  assert.deepEqual([await clicksOf(col, 'a'), await clicksOf(col, 'c')], [450, 400]);
  assert.equal((await status(col, 'b')).month.fever, 150);
}));

test('bets nobody settled come back after a while', needsMongo, () => withDb(async (col) => {
  await col.insertOne({ userId: 'u1', clicks: 1000 });
  const then = new Date();
  await stake(col, { userId: 'u1', betId: id(1), amount: 300, game: 'blackjack' }, then);
  assert.equal(await refundStale(col, 'u1', new Date(then.getTime() + STALE_MS - 1000)), 0, 'not yet');
  const later = await status(col, 'u1', new Date(then.getTime() + STALE_MS + 1000));
  assert.equal(later.refunded, 300);
  assert.equal(later.clicks, 1000);
  await settle(col, [{ userId: 'u1', betId: id(1), payout: 600 }]);
  assert.equal(await clicksOf(col, 'u1'), 1000, 'a late payout for a refunded bet pays nothing');
}));
