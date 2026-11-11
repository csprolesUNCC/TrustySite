// Trusty Blackjack for one player (utils/solo-blackjack-game.js), with games kept in memory and the in-memory
// bank from tools/mock-bank.mjs. The last test plays with the real MongoDB storage and bank, so it only runs
// with BANK_TEST_MONGO_URI set (see tests/bank.test.js).
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
import { play, cleanMove, memoryGames, STALE_HAND_MS } from '../utils/solo-blackjack-game.js';
import soloApi, { mongoGames } from '../utils/solo-blackjack.js';
import { stake, settle } from '../utils/bank.js';
import { mockBank } from '../tools/mock-bank.mjs';

const card = (text) => ({ rank: text.slice(0, -1), suit: text.slice(-1) });
// A shoe that deals these cards first (dealing pops from the end), on top of plenty more.
const rigged = (...cards) => [...Array.from({ length: 200 }, () => card('2♣')), ...cards.map(card).reverse()];
const ME = 'u1';

// Deal order: you, Trusty (face up), you, Trusty (face down), then whatever's drawn.
function game(cards, { clicks = 1000 } = {}) {
  let clock = 1_000_000;
  let ids = 0;
  const store = memoryGames();
  if (cards) store.games.set(ME, { v: 1, shoe: rigged(...cards), round: null, hand: 0, shuffled: false, at: null, settled: true });
  const bank = mockBank({ startingClicks: clicks, delay: 0 });
  const deps = {
    ...store,
    bank,
    now: () => clock,
    random: Math.random,
    newId: () => (++ids).toString(16).padStart(16, '0'),
  };
  return {
    deps,
    bank,
    store,
    move: (m) => play(deps, ME, m && cleanMove(m)),
    look: () => play(deps, ME, null),
    clicks: () => bank.status(ME).clicks,
    open: () => bank.account(ME).open.size,
    wait: (ms) => { clock += ms; },
  };
}

test('only real moves get through', () => {
  for (const amount of [10, 50, 500]) assert.deepEqual(cleanMove({ do: 'deal', amount }), { do: 'deal', amount });
  for (const amount of [0, 5, 15, 510, 1e9, -10, 10.5, '100', { $gt: 0 }, null]) assert.equal(cleanMove({ do: 'deal', amount }), null, String(amount));
  assert.deepEqual(cleanMove({ do: 'insure', take: true }), { do: 'insure', take: true });
  assert.deepEqual(cleanMove({ do: 'insure', take: 'yes' }), { do: 'insure', take: false });
  assert.deepEqual(cleanMove({ do: 'hit', amount: 500 }), { do: 'hit' });
  for (const junk of [null, 'hit', [], {}, { do: 'win' }, { do: { $ne: null } }]) assert.equal(cleanMove(junk), null);
});

test('a hand: the bet comes off, Trusty plays, the win is paid', async () => {
  const g = game(['10♠', '10♣', '9♥', '6♦', '5♠']); // you 19; Trusty 16, draws 5: 21
  let shown = await g.move({ do: 'deal', amount: 100 });
  assert.equal(g.clicks(), 900);
  assert.deepEqual(shown.bank, { clicks: 900, net: -100 });
  assert.equal(shown.round.phase, 'player');
  assert.equal(shown.round.dealer[1], null, 'the hole card stays face down');
  assert.equal(shown.round.seats[0].you, true);
  assert.equal(shown.round.seats[0].id, undefined, 'no account ids');
  assert.equal(JSON.stringify(shown).includes('6♦'), false);

  assert.match((await g.move({ do: 'deal', amount: 100 })).error, /Finish this hand/);
  assert.equal(g.clicks(), 900, 'no second bet mid-hand');

  shown = await g.move({ do: 'stand' });
  assert.equal(shown.round.phase, 'over');
  assert.equal(shown.round.dealer.length, 3);
  assert.equal(shown.round.seats[0].hands[0].result, 'lose');
  assert.equal(g.clicks(), 900);
  assert.equal(g.open(), 0, 'settled');
  assert.match((await g.move({ do: 'hit' })).error, /not your turn/);

  const win = game(['10♠', '10♣', '9♥', '7♦']); // 19 against 17
  await win.move({ do: 'deal', amount: 100 });
  shown = await win.move({ do: 'stand' });
  assert.equal(shown.round.seats[0].hands[0].result, 'win');
  assert.equal(win.clicks(), 1100);
  assert.deepEqual(shown.bank, { clicks: 1100, net: 100 });
});

test('blackjack pays 3 to 2 straight away', async () => {
  const g = game(['A♠', '9♣', 'K♥', '7♦']);
  const shown = await g.move({ do: 'deal', amount: 100 });
  assert.equal(shown.round.phase, 'over');
  assert.equal(shown.round.seats[0].hands[0].result, 'blackjack');
  assert.equal(g.clicks(), 1150);
});

test('insurance against Trusty’s blackjack pays 2 to 1', async () => {
  const g = game(['10♠', 'A♣', '9♥', 'K♦']);
  let shown = await g.move({ do: 'deal', amount: 100 });
  assert.equal(shown.round.phase, 'insurance');
  assert.match((await g.move({ do: 'stand' })).error, /not your turn/);
  shown = await g.move({ do: 'insure', take: true });
  assert.equal(shown.round.phase, 'over');
  assert.equal(shown.round.dealerBlackjack, true);
  assert.equal(g.clicks(), 1000, 'lost 100, insurance won 100');
});

test('doubling and splitting stake the same again', async () => {
  const g = game(['5♠', '10♣', '6♥', '7♦', '10♠']); // 11, double for a 10: 21 against 17
  await g.move({ do: 'deal', amount: 100 });
  const shown = await g.move({ do: 'double' });
  assert.equal(shown.round.seats[0].hands[0].bet, 200);
  assert.equal(shown.round.seats[0].hands[0].result, 'win');
  assert.equal(g.clicks(), 1200);

  const s = game(['8♠', '10♣', '8♥', '9♦', '10♠', '10♥']); // split 8s: 18 and 18 against 19
  await s.move({ do: 'deal', amount: 50 });
  await s.move({ do: 'split' });
  assert.equal(s.clicks(), 900);
  await s.move({ do: 'stand' });
  const done = await s.move({ do: 'stand' });
  assert.deepEqual(done.round.seats[0].hands.map((x) => x.result), ['lose', 'lose']);
  assert.equal(s.clicks(), 900);
  assert.match((await game(['8♠', '10♣', '9♥', '7♦']).move({ do: 'split' })).error, /not your turn/);
});

test('the bank saying no stops the bet', async () => {
  const g = game(['10♠', '10♣', '9♥', '7♦'], { clicks: 50 });
  const shown = await g.move({ do: 'deal', amount: 100 });
  assert.match(shown.error, /only have 50/);
  assert.equal(shown.round, null);
  assert.equal(g.clicks(), 50);
});

test('a move another tab beat gives its stake back', async () => {
  const g = game(['5♠', '10♣', '6♥', '7♦', '10♠']);
  await g.move({ do: 'deal', amount: 100 });
  const save = g.deps.save;
  g.deps.save = async () => { g.deps.save = save; return false; };
  const shown = await g.move({ do: 'double' });
  assert.match(shown.error, /another tab/);
  assert.equal(shown.round.seats[0].hands[0].bet, 100, 'the game as it is');
  assert.equal(g.clicks(), 900, 'the double came back');
  await g.move({ do: 'stand' });
  assert.equal(g.open(), 0);
});

test('a payout that didn’t get through is paid on the next visit, once', async () => {
  const g = game(['10♠', '10♣', '9♥', '7♦']);
  await g.move({ do: 'deal', amount: 100 });
  const settle = g.bank.settle;
  g.deps.bank = { ...g.bank, settle: async () => { throw new Error('the bank is down'); } };
  await assert.rejects(g.move({ do: 'stand' }));
  assert.equal(g.clicks(), 900);
  g.deps.bank = { ...g.bank, settle };
  assert.equal((await g.look()).bank.clicks, 1100);
  await g.look();
  assert.equal(g.clicks(), 1100);
});

test('a hand left alone is stood and settled', async () => {
  const g = game(['10♠', '10♣', '9♥', '7♦']);
  await g.move({ do: 'deal', amount: 100 });
  g.wait(STALE_HAND_MS - 1000);
  assert.equal((await g.look()).round.phase, 'player');
  g.wait(2000);
  const shown = await g.look();
  assert.equal(shown.round.phase, 'over');
  assert.equal(g.clicks(), 1100);
});

test('a first game gets a fresh shoe', async () => {
  const g = game(null);
  const shown = await g.move({ do: 'deal', amount: 10 });
  assert.equal(shown.shuffled, true);
  assert.equal(shown.hand, 1);
  assert.equal(g.store.games.get(ME).shoe.length, 312 - 4 - (shown.round.phase === 'over' ? shown.round.dealer.length - 2 : 0));
});

function call({ method = 'GET', body, user } = {}) {
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
  const cookie = user ? `authToken=${jwt.sign(user, process.env.JWT_SECRET)}` : undefined;
  return Promise.resolve(soloApi({ method, query: { action: 'blackjack' }, headers: { cookie }, body }, res)).then(() => res);
}

test('the endpoint turns away strangers and junk before touching the database', async () => {
  assert.equal((await call()).statusCode, 401);
  assert.equal((await call({ method: 'POST', body: { do: 'deal', amount: 100 } })).statusCode, 401);
  const user = { userId: 'u1', username: 'carson' };
  assert.equal((await call({ method: 'POST', user, body: { do: 'deal', amount: { $gt: 0 } } })).statusCode, 400);
  assert.equal((await call({ method: 'DELETE', user })).statusCode, 405);
});

const uri = process.env.BANK_TEST_MONGO_URI;
test('with MongoDB: a hand, and two tabs at once', { skip: uri ? false : 'set BANK_TEST_MONGO_URI to a throwaway MongoDB to run' }, async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(`solo_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  try {
    const clicks = db.collection('click_game');
    await clicks.insertOne({ userId: ME, username: 'carson', clicks: 1000 });
    let ids = 0;
    const deps = {
      ...mongoGames(db.collection('blackjack_solo')),
      bank: { stake: (op) => stake(clicks, op), settle: (bets) => settle(clicks, bets) },
      now: Date.now,
      random: Math.random,
      newId: () => (++ids).toString(16).padStart(16, '0'),
    };
    // Two first deals at once: one gets the table, the other's bet comes straight back.
    const both = await Promise.all([play(deps, ME, { do: 'deal', amount: 100 }), play(deps, ME, { do: 'deal', amount: 100 })]);
    assert.equal(both.filter((x) => x.error).length, 1, JSON.stringify(both.map((x) => x.error)));
    let shown = both.find((x) => !x.error);
    const doc = await db.collection('blackjack_solo').findOne({ _id: ME });
    assert.equal(doc.round.shoe, undefined, 'the shoe is stored once');
    for (let i = 0; shown.round.phase !== 'over' && i < 10; i++) {
      shown = await play(deps, ME, { do: shown.round.phase === 'insurance' ? 'insure' : 'stand' });
    }
    assert.equal(shown.round.phase, 'over');
    const after = await clicks.findOne({ userId: ME });
    assert.deepEqual(after.bank.open, {}, 'everything settled');
    const back = { blackjack: 250, win: 200, push: 100, lose: 0 }[shown.round.seats[0].hands[0].result];
    const insured = shown.round.seats[0].insurance ? (shown.round.dealerBlackjack ? 100 : -50) : 0;
    assert.equal(after.clicks, 900 + back + insured);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
