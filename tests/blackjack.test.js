// Trusty Blackjack's rules (scripts/blackjack.js), which the online tables deal with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  total, describe, newShoe, deal, insure, insuranceCost, hit, stand, double, split, canDouble, canSplit, raiseCost,
  dealerStep, payouts, view, current, DECKS,
} from '../scripts/blackjack.js';

const card = (text) => ({ rank: text.slice(0, -1), suit: text.slice(-1) });
// A shoe that deals these cards in this order (dealing pops from the end).
const shoeOf = (...cards) => cards.map(card).reverse();
const stake = (id, amount = 100) => ({ id, amount });
const seats = (...amounts) => amounts.map((amount, i) => ({ id: `p${i}`, stake: stake(`b${i}`, amount) }));
const results = (round) => round.seats.map((s) => s.hands.map((h) => h.result));
const playOut = (round) => { while (dealerStep(round)); };

test('hand totals and how they read', () => {
  assert.deepEqual(total(['A♠', '6♥'].map(card)), { value: 17, soft: true });
  assert.deepEqual(total(['A♠', '6♥', 'K♣'].map(card)), { value: 17, soft: false });
  assert.deepEqual(total(['A♠', 'A♥', '9♣'].map(card)), { value: 21, soft: true });
  assert.equal(describe(['A♠', 'K♥'].map(card)), 'Blackjack');
  assert.equal(describe(['A♠', 'K♥'].map(card), true), '21', 'not after a split');
  assert.equal(describe(['A♠', '6♥'].map(card)), '7 / 17');
});

test('a fresh shoe is six whole decks', () => {
  const shoe = newShoe();
  assert.equal(shoe.length, 52 * DECKS);
  assert.equal(new Set(shoe.map((c) => c.rank + c.suit)).size, 52);
});

test('Trusty shows an Ace: insurance, then his blackjack ends the round', () => {
  // Deal order: each seat's first card, Trusty's up card, each seat's second card, Trusty's hole card.
  const round = deal(shoeOf('10♠', '9♥', 'A♣', '10♦', 'K♥', 'K♣'), seats(100, 100));
  assert.equal(round.phase, 'insurance');
  assert.equal(insuranceCost(round, 0), 50);
  assert.deepEqual(view(round).dealer, [card('A♣'), null], 'the hole card stays hidden');
  insure(round, 0, stake('i0', 50));
  assert.equal(round.phase, 'insurance', 'waits for everyone');
  insure(round, 1, null);
  assert.equal(round.phase, 'over');
  assert.equal(round.dealerBlackjack, true);
  assert.deepEqual(results(round), [['lose'], ['lose']]);
  assert.deepEqual(payouts(round), [{ id: 'b0', payout: 0 }, { id: 'i0', payout: 150 }, { id: 'b1', payout: 0 }]);
});

test('even money: a blackjack against an Ace wins exactly one bet either way', () => {
  for (const hole of ['K♣', '5♣']) {
    const round = deal(shoeOf('A♠', 'A♣', 'K♦', hole), seats(100));
    insure(round, 0, stake('i0', insuranceCost(round, 0)));
    playOut(round);
    const back = payouts(round).reduce((sum, p) => sum + p.payout, 0);
    assert.equal(back - 150, 100, `with ${hole} in the hole`);
  }
});

test('a 10 showing: Trusty peeks without asking about insurance', () => {
  const round = deal(shoeOf('9♠', 'K♣', '9♦', 'A♥'), seats(100));
  assert.equal(round.phase, 'over');
  assert.deepEqual(results(round), [['lose']]);
});

test('your blackjack pays 3 to 2 at once', () => {
  const round = deal(shoeOf('A♠', '9♣', '7♦', 'K♥', '10♠', '5♥', '8♦'), seats(100, 100));
  assert.equal(round.phase, 'player');
  assert.equal(round.turn, 1, 'the blackjack is already done, so seat 2 plays first');
  stand(round);
  assert.equal(round.phase, 'dealer');
  playOut(round);
  assert.deepEqual(results(round), [['blackjack'], ['lose']]);
  assert.equal(payouts(round)[0].payout, 250);
});

test('hit, bust, and Trusty only draws for hands still waiting', () => {
  const round = deal(shoeOf('10♠', '6♣', '6♦', '10♥', 'K♣'), seats(100));
  hit(round);
  assert.deepEqual(results(round), [['bust']]);
  assert.equal(round.phase, 'dealer');
  assert.equal(dealerStep(round), false, 'nobody is waiting, so no cards');
  assert.equal(round.dealer.length, 2);
  assert.equal(payouts(round)[0].payout, 0);
});

test('Trusty stands on soft 17', () => {
  const round = deal(shoeOf('10♠', '6♣', '8♦', 'A♥'), seats(100));
  stand(round);
  playOut(round);
  assert.equal(round.dealer.length, 2);
  assert.deepEqual(results(round), [['win']], '18 beats soft 17');
});

test('doubling takes one card and pays on both stakes', () => {
  const round = deal(shoeOf('6♠', '10♣', '5♦', '7♥', '10♦', '8♣'), seats(100));
  assert.equal(canDouble(round), true);
  assert.equal(raiseCost(round), 100);
  double(round, stake('d0', 100));
  assert.equal(round.seats[0].hands[0].cards.length, 3);
  assert.equal(round.phase, 'dealer');
  playOut(round);
  assert.deepEqual(results(round), [['win']]);
  assert.deepEqual(payouts(round), [{ id: 'b0', payout: 200 }, { id: 'd0', payout: 200 }]);
});

test('splitting: each hand gets its second card when it comes up, and can double', () => {
  const round = deal(shoeOf('8♠', '10♣', '8♦', '7♥', '3♠', '2♥', 'K♦', '10♠'), seats(100));
  assert.equal(canSplit(round), true);
  split(round, stake('s0', 100));
  const [first, second] = round.seats[0].hands;
  assert.equal(first.cards.length, 2);
  assert.equal(second.cards.length, 1, 'not yet');
  double(round, stake('d0', 100)); // 8 + 3 + 2 = 13
  assert.equal(round.active, 1);
  assert.equal(second.cards.length, 2, 'now');
  stand(round);
  playOut(round);
  assert.deepEqual(payouts(round).map((p) => p.id), ['b0', 'd0', 's0']);
});

test('split Aces get one card each, and 21 there is not blackjack', () => {
  const round = deal(shoeOf('A♠', '9♣', 'A♦', '7♥', 'K♠', '5♥', '2♣'), seats(100));
  split(round, stake('s0', 100));
  assert.equal(round.phase, 'dealer', 'both hands are done');
  playOut(round);
  assert.deepEqual(results(round), [['win', 'lose']]);
  assert.equal(describe(round.seats[0].hands[0].cards, true), '21');
  assert.equal(payouts(round)[0].payout, 200, '21 after a split pays even money');
});

test('at most four hands', () => {
  const round = deal(shoeOf('8♠', '10♣', '8♦', '7♥', '8♥', '8♣', '8♠', '2♠'), seats(100));
  split(round, stake('s1', 100));
  split(round, stake('s2', 100));
  split(round, stake('s3', 100));
  assert.equal(round.seats[0].hands.length, 4);
  assert.equal(canSplit(round), false);
});

test('seats play in order, then Trusty', () => {
  const round = deal(shoeOf('10♠', '10♣', '7♦', '7♥', '8♥', '9♣', '9♠', '10♦', '5♦'), seats(100, 100, 100));
  assert.equal(round.turn, 0);
  stand(round);
  assert.equal(round.turn, 1);
  stand(round);
  assert.equal(round.turn, 2);
  hit(round); // 7 + 9 + 5 = 21 stands by itself
  assert.equal(round.phase, 'dealer');
  assert.equal(current(round), null);
});

test('thousands of random rounds: every stake is paid exactly once, and the house keeps a little', () => {
  let random = 7;
  const rng = () => {
    random = (random * 16807) % 2147483647;
    return random / 2147483647;
  };
  let shoe = newShoe(rng);
  let staked = 0;
  let paid = 0;
  for (let n = 0; n < 20000; n++) {
    if (shoe.length < 78) shoe = newShoe(rng);
    let ids = 0;
    const round = deal(shoe, seats(10, 20, 50).map((s) => ({ ...s, stake: stake(`r${ids++}`, s.stake.amount) })));
    const stakes = round.seats.map((s) => s.hands[0].stakes[0]);
    while (round.phase === 'insurance') {
      const i = round.seats.findIndex((s) => !s.decided);
      const s = rng() < 0.3 ? stake(`r${ids++}`, insuranceCost(round, i)) : null;
      if (s) stakes.push(s);
      insure(round, i, s);
    }
    while (round.phase === 'player') {
      const roll = rng();
      if (roll < 0.1 && canSplit(round)) stakes.push(stake(`r${ids++}`, raiseCost(round))), split(round, stakes.at(-1));
      else if (roll < 0.2 && canDouble(round)) stakes.push(stake(`r${ids++}`, raiseCost(round))), double(round, stakes.at(-1));
      else if (total(current(round).cards).value < 17) hit(round);
      else stand(round);
    }
    playOut(round);
    assert.equal(round.phase, 'over');
    const out = payouts(round);
    assert.deepEqual(out.map((p) => p.id).sort(), stakes.map((s) => s.id).sort(), 'one payout per stake');
    for (const p of out) assert.ok(Number.isInteger(p.payout) && p.payout >= 0);
    staked += stakes.reduce((sum, s) => sum + s.amount, 0);
    paid += out.reduce((sum, p) => sum + p.payout, 0);
  }
  const back = paid / staked;
  assert.ok(back > 0.85 && back < 1, `returns ${back.toFixed(3)} of every click bet`);
});
