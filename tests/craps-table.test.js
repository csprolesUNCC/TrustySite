// Trusty Craps' online tables (realtime/craps-table.js), with the in-memory bank from tools/mock-bank.mjs.
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CrapsTable, TIMES, MAX_SEATS, versionProblem } from '../realtime/craps-table.js';
import { CLOSE } from '../realtime/common.js';
import { CRAPS_PROTOCOL } from '../scripts/craps.js';
import { mockBank } from '../tools/mock-bank.mjs';

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

// dice: the rolls to come, as [a, b] pairs.
function openTable(names, { clicks = 1000 } = {}) {
  let clock = 1000;
  let ids = 0;
  const rolls = [];
  const bank = mockBank({ startingClicks: clicks, delay: 0 });
  const table = new CrapsTable('BDFG', {
    bank,
    clock: () => clock,
    random: () => (rolls.length ? (rolls.shift() - 0.5) / 6 : Math.random()),
    newId: () => (++ids).toString(16).padStart(16, '0'),
  });
  const people = names.map(person);
  for (const p of people) table.join(p, { id: `id-${p.name}`, name: p.name });
  const run = (ms) => {
    const end = clock + ms;
    while (clock < end) {
      clock += 200;
      table.tick();
    }
  };
  return {
    table,
    people,
    bank,
    run,
    dice: (...pairs) => rolls.push(...pairs.flat()),
    settled: () => new Promise((r) => setTimeout(r, 20)), // the bank answers (payouts aren't awaited)
    clicksOf: (p) => bank.account(`id-${p.name}`).clicks,
  };
}

test('a page and a table only talk if they speak the same version', () => {
  assert.equal(versionProblem(String(CRAPS_PROTOCOL)), null);
  assert.match(versionProblem('0'), /reload/);
});

test('everyone bets on the same dice, and only the shooter rolls', async () => {
  const { table, people: [carson, luke], dice, run, settled, clicksOf } = openTable(['carson', 'luke']);
  assert.equal(carson.last('craps').youShoot, true, 'the first one here shoots');
  assert.equal(luke.last('craps').shooter, 'carson');

  await luke.say(table, { t: 'bet', bets: { dontPass: 100 } });
  await luke.say(table, { t: 'bet', bets: {}, roll: true });
  assert.equal(table.rolls, 0, 'luke isn’t shooting');
  assert.equal(clicksOf(luke), 900);
  assert.deepEqual(carson.last('craps').people.map((p) => p.onTable), [0, 100]);

  dice([3, 3]);
  await carson.say(table, { t: 'bet', bets: { pass: 50, field: 10 }, roll: true });
  assert.equal(table.rolls, 1);
  assert.equal(table.point, 6);
  const seen = carson.last('craps');
  assert.deepEqual(seen.last.dice, [3, 3]);
  assert.equal(seen.last.by, 'carson');
  assert.deepEqual(seen.last.decided, [{ spot: 'field', amount: 10, result: 'lose', payout: 0 }]);
  assert.deepEqual(seen.mine, { pass: 50 });
  assert.deepEqual(luke.last('craps').last.decided, [], 'luke’s Don’t Pass rides');

  // Too soon after a roll: everyone gets to see it first.
  await carson.say(table, { t: 'bet', bets: { odds: 100 }, roll: true });
  assert.equal(table.rolls, 1);
  assert.deepEqual(table.bets.get('id-carson').odds.amount, 100, 'the bet went down anyway');
  run(TIMES.settle);

  dice([4, 3]); // seven out: carson’s line and odds lose, luke’s Don’t Pass wins
  await carson.say(table, { t: 'bet', bets: {}, roll: true });
  await settled();
  assert.equal(table.point, null);
  assert.equal(clicksOf(carson), 1000 - 160);
  assert.equal(clicksOf(luke), 1100);
  assert.equal(luke.last('bank').clicks, 1100);
  assert.equal(table.bets.size, 0);
  assert.equal(luke.last('craps').youShoot, true, 'the dice pass on a seven out');
});

test('bets the rules don’t allow never reach the bank', async () => {
  const { table, people: [carson], dice, clicksOf } = openTable(['carson']);
  await carson.say(table, { t: 'bet', bets: { odds: 100 } });
  assert.match(carson.last('notice').message, /once there’s a point/);
  await carson.say(table, { t: 'bet', bets: { pass: 15 } });
  await carson.say(table, { t: 'bet', bets: { hardways: 10 } });
  await carson.say(table, { t: 'bet', bets: { pass: { $gt: 0 } } });
  assert.equal(clicksOf(carson), 1000);
  dice([2, 2]);
  await carson.say(table, { t: 'bet', bets: { pass: 100 }, roll: true });
  await carson.say(table, { t: 'bet', bets: { odds: 300 } });
  assert.match(carson.last('notice').message, /2 times/);
  await carson.say(table, { t: 'bet', bets: { dontPass: 10 } });
  assert.match(carson.last('notice').message, /come-out/);
  assert.equal(clicksOf(carson), 900);
});

test('one bet the bank turns down sends the others back', async () => {
  const { table, people: [carson], settled, clicksOf } = openTable(['carson'], { clicks: 150 });
  await carson.say(table, { t: 'bet', bets: { pass: 100, field: 100 } });
  await settled();
  assert.match(carson.last('notice').message, /only have 50/);
  assert.equal(clicksOf(carson), 150);
  assert.equal(table.bets.size, 0);
});

test('a shooter who doesn’t roll gets rolled for, and the dice move on', async () => {
  const { table, people: [carson, luke], run, dice } = openTable(['carson', 'luke']);
  run(TIMES.shoot * 2);
  assert.equal(table.rolls, 0, 'no bets, no clock');
  dice([5, 6]);
  await luke.say(table, { t: 'bet', bets: { pass: 10 } });
  assert.ok(luke.last('craps').left > 0);
  run(TIMES.shoot - 200);
  assert.equal(table.rolls, 0);
  run(200);
  assert.equal(table.rolls, 1);
  assert.equal(luke.last('craps').last.auto, true);
  assert.equal(table.shooter, 'id-luke');
  assert.equal(carson.last('craps').left, 0, 'nothing left on the table');
});

test('bets stay on the table when their player gets up, and the last one out rolls everything out', async () => {
  const { table, people: [carson, luke], dice, settled, clicksOf } = openTable(['carson', 'luke']);
  dice([2, 2]);
  await luke.say(table, { t: 'bet', bets: { pass: 100 } });
  await carson.say(table, { t: 'bet', bets: { field: 10 }, roll: true });
  table.leave(luke);
  assert.equal(table.bets.get('id-luke').pass.amount, 100, 'luke’s line bet still rides');
  assert.equal(table.shooter, 'id-carson');
  dice([1, 3]); // carson leaves too: the dice roll until the 4 or a 7
  table.leave(carson);
  await settled();
  assert.equal(table.bets.size, 0);
  assert.equal(clicksOf(luke), 1100);
  assert.equal(table.point, null);
  assert.equal(table.shooter, null);
});

test('the shooter getting up passes the dice to the next seat', () => {
  const { table, people: [carson, luke, hay] } = openTable(['carson', 'luke', 'hay']);
  table.leave(carson);
  assert.equal(table.shooter, 'id-luke');
  table.leave(hay);
  assert.equal(table.shooter, 'id-luke');
  assert.equal(luke.last('craps').people.length, 1);
});

test('seats, codes and idle players', () => {
  const { table, people, run } = openTable(Array.from({ length: MAX_SEATS }, (_, i) => `p${i}`));
  const extra = person('extra');
  assert.equal(table.join(extra, { id: 'id-extra', name: 'extra' }), false);
  assert.equal(extra.closed.code, CLOSE.full);
  const maker = person('maker');
  assert.equal(table.join(maker, { id: 'id-maker', name: 'maker' }, { make: true }), false);
  assert.equal(maker.closed.code, CLOSE.taken);
  const again = person('p0');
  table.join(again, { id: 'id-p0', name: 'p0' });
  assert.equal(people[0].closed.code, CLOSE.replaced);
  run(TIMES.idle + 200);
  assert.equal(table.people.length, 0);
  assert.equal(again.closed.code, CLOSE.idle);
});
