// Trusty Blackjack's online tables (realtime/table.js), with the in-memory bank from tools/mock-bank.mjs.
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Table, TIMES, MAX_SEATS, versionProblem } from '../realtime/table.js';
import { CLOSE } from '../realtime/common.js';
import { TABLE_PROTOCOL } from '../scripts/blackjack.js';
import { mockBank } from '../tools/mock-bank.mjs';

const card = (text) => ({ rank: text.slice(0, -1), suit: text.slice(-1) });
// A shoe that deals these cards first (dealing pops from the end), on top of plenty more.
const rigged = (...cards) => [...Array.from({ length: 200 }, () => card('2♣')), ...cards.map(card).reverse()];

function person(name) {
  return {
    name,
    got: [],
    closed: null,
    send(text) { this.got.push(JSON.parse(text)); },
    close(code, reason) { this.closed = { code, reason }; },
    last(type) { return this.got.filter((m) => m.t === type).at(-1); },
    say(table, msg) { return table.receive(this, JSON.stringify(msg)); },
  };
}

function openTable(names, { clicks = 1000 } = {}) {
  let clock = 1000;
  let ids = 0;
  const bank = mockBank({ startingClicks: clicks, delay: 0 });
  const table = new Table('BDFG', { bank, clock: () => clock, newId: () => (++ids).toString(16).padStart(16, '0') });
  const people = names.map(person);
  for (const p of people) table.join(p, { id: `id-${p.name}`, name: p.name });
  const run = (ms) => {
    const end = clock + ms;
    while (clock < end) {
      clock += 100;
      table.tick();
    }
  };
  const settled = () => new Promise((r) => setTimeout(r, 20)); // the bank answers (payouts aren't awaited)
  return { table, people, bank, run, settled, clicksOf: (p) => bank.account(`id-${p.name}`).clicks };
}

test('a page and a table only talk if they speak the same version', () => {
  assert.equal(versionProblem(String(TABLE_PROTOCOL)), null);
  assert.match(versionProblem('0'), /reload/);
});

test('everyone bets, the hand is dealt at once, and the winners get paid', async () => {
  const { table, people: [carson, luke], run, settled, clicksOf } = openTable(['carson', 'luke']);
  // carson 20, luke 17 against Trusty's 18.
  table.shoe = rigged('10♠', '10♥', '10♦', '10♣', '7♠', '8♥');
  await carson.say(table, { t: 'bet', amount: 100 });
  assert.equal(table.phase, 'betting', 'waits for luke');
  assert.equal(carson.last('bank').clicks, 900);
  await luke.say(table, { t: 'bet', amount: 50 });
  assert.equal(table.phase, 'player');
  const shown = carson.last('table').round;
  assert.equal(shown.dealer[1], null, 'Trusty’s hole card stays face down');
  assert.deepEqual(shown.seats.map((s) => [s.name, s.you]), [['carson', true], ['luke', false]]);
  assert.equal(luke.last('table').round.seats[1].you, true);

  await luke.say(table, { t: 'stand' }); // not luke's turn
  assert.equal(table.round.turn, 0);
  await carson.say(table, { t: 'stand' });
  await luke.say(table, { t: 'stand' });
  assert.equal(table.phase, 'dealer');
  run(TIMES.dealer * 2);
  assert.equal(table.phase, 'over');
  await settled();
  assert.equal(clicksOf(carson), 1100);
  assert.equal(clicksOf(luke), 950);
  assert.equal(carson.last('bank').clicks, 1100);
  assert.deepEqual(carson.last('table').round.seats.map((s) => s.hands[0].result), ['win', 'lose']);
});

test('one bet: the others get a few seconds, then it’s dealt without them', async () => {
  const { table, people: [carson, luke], run } = openTable(['carson', 'luke']);
  await carson.say(table, { t: 'bet', amount: 10 });
  assert.ok(carson.last('table').left > 0, 'a countdown');
  run(TIMES.betting + 200);
  assert.notEqual(table.phase, 'betting');
  assert.deepEqual(table.round.seats.map((s) => s.id), ['id-carson']);
  assert.equal(luke.last('table').round.seats.length, 1, 'luke watches');
});

test('bets have to be real, and covered', async () => {
  const { table, people: [carson], bank } = openTable(['carson'], { clicks: 40 });
  for (const amount of [5, 15, 501, '100', null, { $gt: 0 }, 1e9, 0, -10]) await carson.say(table, { t: 'bet', amount });
  assert.equal(table.people[0].bet, null);
  await carson.say(table, { t: 'bet', amount: 50 });
  assert.match(carson.last('notice').message, /only have 40/);
  assert.equal(bank.account('id-carson').clicks, 40);
  await carson.say(table, { t: 'bet', amount: 600 });
  assert.equal(bank.account('id-carson').open.size, 0);
});

test('running out of time stands for you', async () => {
  const { table, people: [carson], run } = openTable(['carson']);
  table.shoe = rigged('10♠', '7♥', '6♦', '10♣');
  await carson.say(table, { t: 'bet', amount: 10 });
  assert.equal(table.phase, 'player');
  run(TIMES.turn - 500);
  assert.equal(table.phase, 'player');
  run(1000);
  assert.notEqual(table.phase, 'player');
  assert.equal(table.round.seats[0].hands[0].cards.length, 2, 'stood, didn’t hit');
});

test('double and split are paid for first, and paid out on each stake', async () => {
  const { table, people: [carson], run, settled, clicksOf } = openTable(['carson']);
  // 8 8 against Trusty's 6 + 10, splits into 8+3 (doubled: +9 = 20) and 8+10 = 18; Trusty draws a 9 and busts.
  table.shoe = rigged('8♠', '6♥', '8♦', '10♣', '3♠', '9♥', '10♦', '9♣');
  await carson.say(table, { t: 'bet', amount: 100 });
  await carson.say(table, { t: 'split' });
  assert.equal(clicksOf(carson), 800);
  await carson.say(table, { t: 'double' });
  assert.equal(clicksOf(carson), 700);
  await carson.say(table, { t: 'stand' });
  run(TIMES.dealer * 3);
  await settled();
  assert.deepEqual(table.round.seats[0].hands.map((h) => h.result), ['win', 'win']);
  assert.equal(clicksOf(carson), 700 + 400 + 200);
});

test('insurance against Trusty’s Ace', async () => {
  const { table, people: [carson, luke], settled, clicksOf } = openTable(['carson', 'luke']);
  table.shoe = rigged('10♠', '9♥', 'A♦', '10♣', '8♥', 'K♣');
  await carson.say(table, { t: 'bet', amount: 100 });
  await luke.say(table, { t: 'bet', amount: 100 });
  assert.equal(table.phase, 'insurance');
  await carson.say(table, { t: 'insure', take: true });
  assert.equal(clicksOf(carson), 850);
  await luke.say(table, { t: 'insure', take: false });
  assert.equal(table.phase, 'over', 'Trusty had blackjack');
  await settled();
  assert.equal(clicksOf(carson), 1000, 'insurance paid 2 to 1 and covered the bet');
  assert.equal(clicksOf(luke), 900);
});

test('getting up mid-hand: your turn is skipped, and the hand still pays', async () => {
  const { table, people: [carson, luke], settled, clicksOf, run } = openTable(['carson', 'luke']);
  table.shoe = rigged('10♠', '10♥', '7♦', '10♣', '9♠', '10♦');
  await carson.say(table, { t: 'bet', amount: 100 });
  await luke.say(table, { t: 'bet', amount: 100 });
  table.leave(carson);
  assert.equal(table.round.turn, 1, 'luke is up');
  table.leave(luke);
  assert.equal(table.phase, 'betting', 'nobody left: played out');
  await settled();
  assert.equal(clicksOf(carson), 1100, '20 beats 17');
  assert.equal(clicksOf(luke), 1100, '19 beats 17');
  run(1000);
  assert.equal(table.tickEvery(), 0, 'an empty table stops ticking');
});

test('a bet for a hand you leave before is given back', async () => {
  const { table, people: [carson, luke], settled, clicksOf } = openTable(['carson', 'luke']);
  await carson.say(table, { t: 'bet', amount: 100 });
  table.leave(carson);
  await settled();
  assert.equal(clicksOf(carson), 1000);
  assert.equal(table.deadline, 0, 'no countdown for nobody');
  assert.equal(luke.last('table').people.length, 1);
});

test('a slow bank holds the clock, and a raise that comes too late is given back', async () => {
  const { table, people: [carson], run, bank, settled, clicksOf } = openTable(['carson']);
  table.shoe = rigged('5♠', '10♥', '6♦', '7♣', '10♣');
  await carson.say(table, { t: 'bet', amount: 100 });
  const slow = bank.stake;
  let release;
  bank.stake = (...args) => new Promise((r) => { release = () => r(slow(...args)); });
  const doubling = carson.say(table, { t: 'double' });
  run(TIMES.turn + 5000);
  assert.equal(table.phase, 'player', 'still waiting on the bank');
  release();
  await doubling;
  assert.equal(table.round.seats[0].hands[0].stakes.length, 2, 'doubled');
  bank.stake = slow;
  run(TIMES.dealer * 4);
  await settled();
  assert.ok([800, 1000, 1200].includes(clicksOf(carson)));
  assert.equal(bank.account('id-carson').open.size, 0, 'nothing left open');
});

test('six is a crowd, a second tab takes over, and idle players get up', async () => {
  const names = Array.from({ length: MAX_SEATS }, (_, i) => `p${i}`);
  const { table, people, run } = openTable(names);
  const extra = person('extra');
  assert.equal(table.join(extra, { id: 'id-extra', name: 'extra' }), false);
  assert.equal(extra.closed.code, CLOSE.full);
  const again = person('p0');
  table.join(again, { id: 'id-p0', name: 'p0' });
  assert.equal(people[0].closed.code, CLOSE.replaced);
  assert.equal(table.people.length, MAX_SEATS);

  await again.say(table, { t: 'bet', amount: 10 });
  run(TIMES.idle - 1000);
  assert.equal(people[1].closed, null);
  run(TIMES.betting + 60000);
  assert.equal(people[1].closed.code, CLOSE.idle);
});
