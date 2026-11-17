// Trusty Poker's online tables (realtime/poker-table.js), with the in-memory bank from tools/mock-bank.mjs.
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PokerTable, TIMES, MAX_PEOPLE, TIMEOUTS_TO_STAND, versionProblem } from '../realtime/poker-table.js';
import { CLOSE } from '../realtime/common.js';
import { POKER_PROTOCOL, SEATS, inHand } from '../scripts/poker.js';
import { mockBank } from '../tools/mock-bank.mjs';
import { seeded } from './seeded.js';

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

function openTable(names, { clicks = 1000, seed = 9 } = {}) {
  let clock = 1000;
  let ids = 0;
  const bank = mockBank({ startingClicks: clicks, delay: 0 });
  const table = new PokerTable('BDFG', { bank, clock: () => clock, random: seeded(seed), newId: () => (++ids).toString(16).padStart(16, '0') });
  const people = names.map(person);
  for (const p of people) table.join(p, { id: `id-${p.name}`, name: p.name });
  const run = (ms) => {
    const end = clock + ms;
    while (clock < end) {
      clock += 250;
      table.tick();
    }
  };
  return {
    table,
    people,
    bank,
    run,
    settled: () => new Promise((r) => setTimeout(r, 20)),
    clicksOf: (p) => bank.account(`id-${p.name}`).clicks,
    open: (p) => bank.account(`id-${p.name}`).open.size,
  };
}

// Plays whoever's up among `people` with `choose`, and lets bots and the clock run, until `done()`.
async function playUntil(t, people, done, choose = (can) => (can.check ? { do: 'check' } : { do: 'call' })) {
  for (let guard = 0; guard < 4000 && !done(); guard++) {
    for (const p of people) {
      const m = p.last('poker');
      if (m && m.table && m.table.hand && m.table.hand.legal && m.table.hand.toAct === m.seat) await p.say(t.table, { t: 'act', action: choose(m.table.hand.legal) });
    }
    t.run(250);
  }
  assert.ok(done(), 'got there');
}

test('a page and a table only talk if they speak the same version', () => {
  assert.equal(versionProblem(String(POKER_PROTOCOL)), null);
  assert.match(versionProblem('0'), /reload/);
});

test('two friends sit down, bots fill the table, and a hand gets played', async () => {
  const t = openTable(['carson', 'luke']);
  const { table, people: [carson, luke], run, clicksOf } = t;
  await carson.say(table, { t: 'sit', buyIn: 200 });
  assert.equal(clicksOf(carson), 800);
  assert.equal(carson.last('poker').waiting, true);
  await luke.say(table, { t: 'sit', buyIn: 100 });
  assert.match(luke.last('notice').message, /200-click buy-ins/, 'the first to sit picks the stakes');
  assert.equal(clicksOf(luke), 1000);
  await luke.say(table, { t: 'sit', buyIn: 200 });
  run(TIMES.first);
  const seen = carson.last('poker');
  assert.ok(inHand(table.table));
  assert.equal(seen.table.seats.filter(Boolean).length, SEATS, 'bots fill the empty seats');
  assert.equal(seen.table.seats.filter((s) => s && !s.bot).length, 2);
  const mine = seen.table.hand.players[seen.seat];
  assert.equal(mine.cards.length, 2, 'you see your cards');
  const theirs = seen.table.hand.players[luke.last('poker').seat];
  assert.equal(theirs.cards, null, 'and not luke’s');
  const hands = table.table.hands;
  await playUntil(t, [carson, luke], () => table.table.hands > hands);
});

test('getting up pays the stack back, after the hand', async () => {
  const t = openTable(['carson']);
  const { table, people: [carson], run, settled, clicksOf, open } = t;
  await carson.say(table, { t: 'sit', buyIn: 100 });
  run(TIMES.first);
  const seat = carson.last('poker').seat;
  assert.ok(table.table.hand.p[seat], 'dealt in');
  await carson.say(table, { t: 'leave' });
  assert.equal(carson.last('poker').leaving, true);
  await playUntil(t, [carson], () => !table.sits.size, (can) => (can.check ? { do: 'check' } : { do: 'fold' }));
  await settled();
  assert.equal(open(carson), 0);
  assert.match(carson.last('notice').message, /got up with/);
  assert.ok(clicksOf(carson) > 900 - 100 && clicksOf(carson) <= 1000 + 500);
  assert.equal(table.table, null, 'nobody sitting: the table closes, and the next one to sit picks the stakes');
});

test('a player who runs out of time checks or folds, and gets up after a few hands of it', async () => {
  const t = openTable(['carson', 'luke']);
  const { table, people: [carson, luke], run } = t;
  await carson.say(table, { t: 'sit', buyIn: 100 });
  await luke.say(table, { t: 'sit', buyIn: 100 });
  run(TIMES.first);
  // luke plays; carson never does.
  await playUntil(t, [luke], () => ![...table.sits.values()].some((s) => s.id === 'id-carson'));
  assert.match(carson.got.filter((m) => m.t === 'notice').map((m) => m.message).join(' '), new RegExp(`${TIMEOUTS_TO_STAND} hands in a row`));
});

test('the last one to leave plays the hand out and everyone is paid', async () => {
  const t = openTable(['carson', 'luke']);
  const { table, people: [carson, luke], run, settled, open } = t;
  await carson.say(table, { t: 'sit', buyIn: 500 });
  await luke.say(table, { t: 'sit', buyIn: 500 });
  run(TIMES.first);
  table.leave(carson);
  table.leave(luke);
  await settled();
  assert.equal(open(carson), 0);
  assert.equal(open(luke), 0);
  assert.equal(table.table, null);
  assert.equal(table.tickEvery(), 0);
});

test('a dropped connection keeps the seat until the hand is over', async () => {
  const t = openTable(['carson', 'luke']);
  const { table, people: [carson, luke], run } = t;
  await carson.say(table, { t: 'sit', buyIn: 100 });
  await luke.say(table, { t: 'sit', buyIn: 100 });
  run(TIMES.first);
  const seat = carson.last('poker').seat;
  const live = !table.table.hand.p[seat].folded;
  table.leave(carson);
  if (live) {
    assert.ok(table.sits.has(seat), 'still in the hand');
    const back = person('carson');
    table.join(back, { id: 'id-carson', name: 'carson' });
    assert.equal(table.table.seats[seat].leaving, false, 'back in time: still sitting');
    assert.equal(back.last('poker').seat, seat);
  }
});

test('a buy-in the bank refuses seats nobody; junk changes nothing', async () => {
  const t = openTable(['carson'], { clicks: 50 });
  const { table, people: [carson], run } = t;
  await carson.say(table, { t: 'sit', buyIn: 100 });
  assert.match(carson.last('notice').message, /only have 50/);
  await carson.say(table, { t: 'sit', buyIn: 150 });
  await carson.say(table, { t: 'sit', buyIn: { $gt: 0 } });
  await carson.say(table, { t: 'act', action: { do: 'raise', to: 1e9 } });
  run(TIMES.first * 2);
  assert.equal(table.table, null);
  assert.equal(table.sits.size, 0);
});

test('seats, codes and idle watchers', () => {
  const { table, people, run } = openTable(Array.from({ length: MAX_PEOPLE }, (_, i) => `p${i}`));
  const extra = person('extra');
  assert.equal(table.join(extra, { id: 'id-extra', name: 'extra' }), false);
  assert.equal(extra.closed.code, CLOSE.full);
  const maker = person('maker');
  assert.equal(table.join(maker, { id: 'id-maker', name: 'maker' }, { make: true }), false);
  assert.equal(maker.closed.code, CLOSE.taken);
  run(TIMES.idle + 250);
  assert.equal(table.people.length, 0);
  assert.equal(people[0].closed.code, CLOSE.idle);
});
