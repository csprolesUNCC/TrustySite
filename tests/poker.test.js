// Trusty Poker's rules (scripts/poker.js) and bots (scripts/poker-bots.js), with rigged decks and a seeded random.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEATS, STAKES, CASH_OUT_TIMES, MAX_RETURN, RAKE, evaluate, describeScore, bestFive, newTable, sit, startHand, act,
  legal, potsOf, mustLeave, view, cleanAction, inHand, freeSeats,
} from '../scripts/poker.js';
import { STYLES, ROSTER, chen, equity, decide, pickBot } from '../scripts/poker-bots.js';
import { MAX_RETURN as BANK_MAX, GAMES, LIMITS } from '../utils/bank-rules.js';
import { seeded } from './seeded.js';

const score = (s) => evaluate(s.split(' '));
const name = (s) => describeScore(score(s));

// A table with these seats (null for empty), and a deck that deals `cards` first: each player's first card going
// round from the small blind, then their second, then (burn, flop x3, burn, turn, burn, river).
function rigged(buyIn, players, cards) {
  const table = newTable(buyIn);
  players.forEach((p, i) => { if (p) sit(table, i, { id: p, name: p }); });
  table.button = -1;
  const deal = () => {
    const rest = [];
    for (const r of '23456789TJQKA') for (const s of 'shdc') if (!cards.includes(r + s)) rest.push(r + s);
    return [...rest, ...[...cards].reverse()];
  };
  return { table, start: () => { startHand(table, Math.random); table.hand.deck = deal(); dealAgain(table); } };
}
// startHand dealt from a random deck: deal the rigged one instead, the same way.
function dealAgain(table) {
  const h = table.hand;
  for (const p of h.p) if (p) p.cards = [];
  for (let round = 0; round < 2; round++) {
    let i = h.sbSeat;
    do {
      h.p[i].cards.push(h.deck.pop());
      do i = (i + 1) % SEATS; while (!h.p[i]);
    } while (i !== h.sbSeat);
  }
}

test('hands rank the way they should', () => {
  const order = [
    'Ah Kd 9c 7s 5h 3d 2c', // high card
    '9c 9d 4h 7s Jc 2d 3h', // pair
    'Ah Ad Kc Kd Qs 2h 3c', // two pair
    'Kh Kd Kc 2s 7d 3c 9h', // trips
    '5d 4c 3h 2s Ah Kd Qc', // wheel
    '9d Tc Jh Qs Kh 2d 2c', // straight
    '2h 7h 9h Jh Kh Ad 3c', // flush
    'Kh Kd Kc 2s 2d 3c 3h', // full house
    'Ah Ad Ac As Kd 2c 3c', // quads
    '5s 4s 3s 2s As Kd Qc', // steel wheel
    'As Ks Qs Js Ts 2d 3c', // royal
  ];
  for (let k = 1; k < order.length; k++) assert.ok(score(order[k]) > score(order[k - 1]), `${order[k]} beats ${order[k - 1]}`);
  assert.equal(name(order[0]), 'Ace high');
  assert.equal(name(order[4]), 'Five-high straight');
  assert.equal(name(order[7]), 'Full house, Kings full of Threes');
  assert.equal(name(order[10]), 'Royal flush');
  assert.equal(name('Ah Ad Kc Kd Qs Qh 2c'), 'Two pair, Aces and Kings');
  // Kickers count, the sixth and seventh cards don't.
  assert.ok(score('Ah Ad Kc 7d 5s 3h 2c') > score('Ah Ac Qc 7d 5s 3h 2c'));
  assert.equal(score('Ah Ad Kc Qd Js 3h 2c'), score('As Ac Kd Qh Jc 4h 2d'));
  // Two trips make a full house with the lower as the pair; three pairs play the top two.
  assert.equal(name('Kh Kd Kc 9s 9d 9c 2h'), 'Full house, Kings full of Nines');
  assert.ok(score('Ah Ad Kc Kd 2s 2h Qc') > score('Ah Ad Kc Kd 2s 2h Jc'));
  assert.deepEqual(bestFive('As Ks Qs Js Ts 2d 3c'.split(' ')).sort(), ['As', 'Js', 'Ks', 'Qs', 'Ts']);
});

test('blinds, turns and the big blind’s option', () => {
  const { table, start } = rigged(200, ['a', 'b', 'c'], []);
  start();
  const h = table.hand;
  assert.equal(table.button, 0);
  assert.equal(h.sbSeat, 1);
  assert.equal(h.bbSeat, 2);
  assert.equal(table.seats[1].stack, 198);
  assert.equal(table.seats[2].stack, 196);
  assert.equal(h.toAct, 0, 'first to act is after the big blind');
  assert.equal(act(table, 1, { do: 'call' }), false, 'not your turn');
  assert.ok(act(table, 0, { do: 'call' }));
  assert.ok(act(table, 1, { do: 'call' }));
  assert.equal(h.street, 'preflop', 'the big blind still gets to act');
  assert.deepEqual(legal(table, 2), { check: true, call: 0, raise: { min: 8, max: 200 }, bet: false });
  assert.ok(act(table, 2, { do: 'check' }));
  assert.equal(h.street, 'flop');
  assert.equal(h.board.length, 3);
  assert.equal(h.toAct, 1, 'after the flop, the first player left of the button');
});

test('heads up, the button posts the small blind and acts first before the flop', () => {
  const { table, start } = rigged(100, ['a', 'b'], []);
  start();
  assert.equal(table.hand.sbSeat, table.button);
  assert.equal(table.hand.toAct, table.button);
  act(table, table.button, { do: 'call' });
  act(table, table.hand.bbSeat, { do: 'check' });
  assert.equal(table.hand.toAct, table.hand.bbSeat, 'and last after it');
});

test('raises: at least the last raise, all in for less doesn’t reopen it', () => {
  const { table, start } = rigged(200, ['a', 'b', 'c'], []);
  start();
  assert.equal(act(table, 0, { do: 'raise', to: 7 }), false, 'a raise has to be at least a big blind more');
  assert.ok(act(table, 0, { do: 'raise', to: 12 }));
  assert.equal(legal(table, 1).raise.min, 20, 'the next raise is at least as big again');
  table.seats[2].stack = 20; // c has only 24 behind in all: all in to 24 is less than a full raise
  act(table, 1, { do: 'fold' });
  assert.equal(legal(table, 2).raise.max, 24);
  assert.ok(act(table, 2, { do: 'raise', to: 24 }));
  const can = legal(table, 0);
  assert.equal(can.call, 12);
  assert.equal(can.raise, null, 'a short all-in doesn’t let a raiser raise again');
});

test('everyone else folds: the bet nobody called comes back, no flop means no rake', () => {
  const { table, start } = rigged(200, ['a', 'b', 'c'], []);
  start();
  act(table, 0, { do: 'raise', to: 50 });
  act(table, 1, { do: 'fold' });
  act(table, 2, { do: 'fold' });
  assert.equal(table.hand.street, 'over');
  assert.equal(table.hand.result.rake, 0);
  assert.equal(table.seats[0].stack, 200 + 2 + 4);
  assert.deepEqual(table.hand.result.returned, { seat: 0, amount: 46 });
  assert.deepEqual(table.hand.result.shown, {}, 'nobody shows');
});

test('side pots: the short stack can only win what it covered', () => {
  // Deal order from the small blind (seat 1): b, c, a, then second cards. a has Aces, b Kings, c Queens; the board
  // helps nobody.
  const { table, start } = rigged(200, ['a', 'b', 'c'], ['Kh', 'Qh', 'Ah', 'Kd', 'Qd', 'Ad', '2c', '3s', '7d', '9c', '2h', 'Jd', '4h', '5c']);
  start();
  table.seats[0].stack = 50; // a has only 50
  act(table, 0, { do: 'raise', to: 50 });
  act(table, 1, { do: 'raise', to: 150 });
  act(table, 2, { do: 'call' });
  // b and c check it down.
  while (inHand(table)) act(table, table.hand.toAct, { do: 'check' });
  const r = table.hand.result;
  assert.equal(r.pots.length, 2);
  assert.deepEqual(r.pots[0].winners, [0], 'Aces take the main pot');
  assert.deepEqual(r.pots[1].winners, [1], 'Kings take the side pot');
  const rake = Math.min(Math.floor(350 * RAKE.rate), RAKE.capBB * table.bb);
  assert.equal(r.rake, rake);
  assert.equal(table.seats[0].stack, 150 - rake, 'the rake comes out of the main pot');
  assert.equal(table.seats[1].stack, 50 + 200);
  assert.equal(table.seats[2].stack, 50);
  assert.equal(r.shown[0].name, 'Pair of Aces');
});

test('a split pot splits, the odd chip goes left of the button', () => {
  const { table } = rigged(100, ['a', 'b', 'c'], []);
  table.hand = {
    p: [{ total: 5, folded: false }, { total: 5, folded: false }, { total: 1, folded: true }],
  };
  const { pots } = potsOf(table.hand);
  assert.deepEqual(pots, [{ amount: 11, eligible: [0, 1] }]);
  const { table: t, start } = rigged(100, ['a', 'b'], ['Ah', 'Ad', 'Kh', 'Kd', '2c', '5s', '7d', '9c', '2h', 'Jd', '4h', 'Qc']);
  start(); // the button (0) is the small blind: a gets Ah Kh, b gets Ad Kd: the same hand
  act(t, 0, { do: 'call' });
  while (inHand(t)) act(t, t.hand.toAct, { do: 'check' });
  assert.equal(t.hand.result.pots[0].winners.length, 2);
  assert.equal(t.seats[0].stack + t.seats[1].stack, 200 - t.hand.result.rake);
});

test('all in before the flop deals the rest and shows down', () => {
  const { table, start } = rigged(100, ['a', 'b'], []);
  start();
  act(table, 0, { do: 'raise', to: 100 });
  act(table, 1, { do: 'call' });
  assert.equal(table.hand.street, 'over');
  assert.equal(table.hand.board.length, 5);
  assert.equal(Object.keys(table.hand.result.shown).length, 2);
  assert.equal(table.seats[0].stack + table.seats[1].stack, 200 - table.hand.result.rake);
});

test('players see their own cards, never anyone else’s before showdown or the deck', () => {
  const { table, start } = rigged(200, ['a', 'b', 'c'], []);
  start();
  const v = view(table, 0);
  assert.equal(v.hand.players[0].cards.length, 2);
  assert.equal(v.hand.players[1].cards, null);
  assert.equal(v.hand.players[2].cards, null);
  assert.equal(JSON.stringify(v).includes('deck'), false);
  assert.equal(view(table, -1).hand.players[0].cards, null, 'someone watching sees nobody’s');
});

test('only real actions get through', () => {
  assert.deepEqual(cleanAction({ do: 'raise', to: 40 }), { do: 'raise', to: 40 });
  for (const junk of [null, 'fold', {}, { do: 'raise' }, { do: 'raise', to: '40' }, { do: 'raise', to: -1 }, { do: 'raise', to: 1.5 }, { do: { $ne: 1 } }]) {
    assert.equal(cleanAction(junk), null);
  }
});

test('stakes fit the bank, and nobody can leave with more than it will pay', () => {
  assert.ok(GAMES.includes('poker'));
  assert.equal(BANK_MAX.poker, MAX_RETURN);
  assert.equal(MAX_RETURN, SEATS * CASH_OUT_TIMES);
  for (const s of STAKES) {
    assert.ok(s.buyIn <= LIMITS.maxStake, 'a buy-in is one bet');
    assert.equal(s.bb, s.sb * 2);
    assert.ok(s.buyIn / s.bb >= 40, 'a buy-in is plenty of big blinds');
  }
});

test('bots only ever make legal moves, chips add up, and every stack stays under the cap', () => {
  const random = seeded(42);
  const table = newTable(100);
  for (let i = 0; i < SEATS; i++) sit(table, i, pickBot(table, random));
  for (let n = 0; n < 600; n++) {
    for (const { seat } of mustLeave(table)) table.seats[seat] = null;
    for (const i of freeSeats(table)) sit(table, i, pickBot(table, random));
    for (const s of table.seats) assert.ok(s.stack < CASH_OUT_TIMES * table.buyIn, 'nobody starts a hand at the cap');
    const before = table.seats.reduce((sum, s) => sum + s.stack, 0);
    assert.ok(startHand(table, random));
    for (let guard = 0; inHand(table); guard++) {
      assert.ok(guard < 200);
      const i = table.hand.toAct;
      const move = decide(table, i, random);
      assert.ok(act(table, i, move), `${table.seats[i].bot}: ${JSON.stringify(move)} with ${JSON.stringify(legal(table, i))}`);
    }
    const after = table.seats.reduce((sum, s) => sum + s.stack, 0);
    assert.equal(after + table.hand.result.rake, before, 'only the rake leaves the table');
    for (const s of table.seats) assert.ok(s.stack < MAX_RETURN * table.buyIn);
  }
});

test('the bots know a good hand from a bad one', () => {
  assert.equal(chen(['Ah', 'Ad']), 20);
  assert.equal(chen(['Ah', 'Kh']), 12);
  assert.equal(chen(['7h', '2d']), -1);
  assert.equal(chen(['2h', '2d']), 5);
  const random = seeded(7);
  assert.ok(Math.abs(equity(['Ah', 'Ad'], [], 1, random, 4000) - 0.85) < 0.03, 'Aces win about 85% heads up');
  assert.ok(equity(['7h', '2d'], [], 1, random, 4000) < 0.4);
  assert.equal(equity(['Ah', 'Kh'], ['Qh', 'Jh', 'Th'], 3, random, 200), 1, 'a royal flush can’t lose');
  // Facing a big raise with 7-2, every style folds; with Aces nobody does.
  for (const style of Object.keys(STYLES)) {
    for (let k = 0; k < 20; k++) {
      const { table, start } = rigged(200, ['a', 'b', 'c'], ['Ah', 'Kc', '7h', 'Ad', 'Kd', '2d']);
      start();
      act(table, 0, { do: 'raise', to: 60 });
      table.seats[1].bot = style;
      table.seats[2].bot = style;
      act(table, 1, decide(table, 1, random)); // the small blind holds Ah Ad
      assert.notEqual(table.hand.p[1].folded, true, `${style} folded Aces`);
    }
    const { table, start } = rigged(200, ['a', 'b', 'c'], ['7h', 'Kc', 'Ah', '2d', 'Kd', 'Ad']);
    start();
    act(table, 0, { do: 'raise', to: 60 });
    table.seats[1].bot = style;
    const folds = Array.from({ length: 20 }, () => decide(table, 1, random).do === 'fold').filter(Boolean).length;
    assert.ok(folds >= 18, `${style} folded 7-2 to a big raise only ${folds} times in 20`);
  }
  assert.ok(ROSTER.some((b) => b.name === 'Trusty'));
  assert.ok(ROSTER.length >= SEATS, 'enough bots to fill a table');
});
