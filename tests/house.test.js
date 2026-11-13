// Trusty's casino winnings (utils/house.js): the house's side of everyone's betting stats.
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseWinnings, forgetHouse, isHouse, HOUSE_NAME } from '../utils/house.js';
import { mockBank } from '../tools/mock-bank.mjs';

// Just enough of a MongoDB collection for houseWinnings(): find(...).toArray().
function collection(docs) {
  let finds = 0;
  return {
    get finds() { return finds; },
    find(query) {
      finds += 1;
      assert.deepEqual(query, { 'bank.stats': { $exists: true } });
      return { toArray: async () => docs.filter((d) => d.bank && d.bank.stats) };
    },
  };
}

test('Trusty’s account is the house, whatever the capitals', () => {
  assert.equal(HOUSE_NAME, 'Trusty');
  for (const name of ['Trusty', 'trusty', 'TRUSTY']) assert.equal(isHouse(name), true);
  for (const name of ['Trusty2', 'carson', '', null, { $ne: null }]) assert.equal(isHouse(name), false);
});

test('the house wins what players lose and loses what they win, every month, every game', async () => {
  forgetHouse();
  const col = collection([
    { bank: { stats: { blackjack: { '2026-10': -300, '2026-11': 50 }, craps: { '2026-11': -120 } } } },
    { bank: { stats: { blackjack: { '2026-11': 200 }, fever: { '2026-11': -1 } } } },
    { bank: { net: 0 } },
    { clicks: 10 },
  ]);
  assert.deepEqual(await houseWinnings(col, 0), { total: 300 - 50 + 120 - 200 + 1, games: { blackjack: 50, craps: 120, fever: 1 } });
  await houseWinnings(col, 30_000);
  assert.equal(col.finds, 1, 'kept for a minute');
  await houseWinnings(col, 61_000);
  assert.equal(col.finds, 2);
});

test('a lucky run for the players puts the house below zero', async () => {
  forgetHouse();
  const { total } = await houseWinnings(collection([{ bank: { stats: { craps: { '2026-11': 900 } } } }]), 0);
  assert.equal(total, -900);
});

test('the pretend bank adds the house up the same way', async () => {
  const bank = mockBank({ delay: 0 });
  await bank.stake({ userId: 'a', betId: '0000000000000001', amount: 100, game: 'craps' });
  await bank.settle([{ userId: 'a', betId: '0000000000000001', payout: 0 }]);
  await bank.stake({ userId: 'b', betId: '0000000000000002', amount: 50, game: 'blackjack' });
  await bank.settle([{ userId: 'b', betId: '0000000000000002', payout: 100 }]);
  const house = bank.house();
  assert.equal(house.total, 50);
  assert.equal(house.games.craps, 100);
  assert.equal(house.games.blackjack, -50);
});
