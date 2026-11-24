import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  importHunt, normalize, viewFor, intermission, mapOf, readMap, distance, newCode, broadcastAt, coordDigits, DAY_MS, CHECKS,
} from '../utils/hunt-rules.js';
import { handle } from '../utils/hunt-game.js';
import { memoryHunt } from '../utils/hunt-store.js';

// A made-up hunt: the real one's answers never go in this public repo (see utils/hunt-rules.js).
const START = Date.parse('2027-01-01T12:00:00Z');
const SAMPLE = {
  title: 'Test Hunt',
  rewards: { stage: 100, first: 5000, finder: 500 },
  signal: {
    every: 3,
    cards: [{ channel: 'trusty', mark: 'I', text: 'ABCD' }, { channel: 'snn', mark: 'II', text: 'EFGH' }],
    hints: [{ day: 2, text: 'Watch closely.' }],
  },
  door: 'test-door',
  stages: [
    { id: 'radio', title: 'Dead Air', day: 7, body: ['Tune in.'], answer: 'first answer', radio: { mhz: 99.9, lines: ['one', 'two'] }, hints: [{ day: 3, text: 'Listen.' }] },
    { id: 'shares', title: 'Shares', day: 14, body: [{ pre: 'grid' }], answer: 'SECOND' },
  ],
  final: { title: 'The Map', day: 21, body: ['Deal.'], note: 'Under the bench.', radius: 30 },
};
const COORDS = { lat: 35.20575, lng: -80.7613 };

function newHunt(extra = {}) {
  return { ...importHunt({ ...SAMPLE, ...extra }), live: true, startsAt: new Date(START).toISOString() };
}

test('answers are compared without spaces, punctuation, capitals or accents', () => {
  assert.equal(normalize('  Over the hills! '), 'OVERTHEHILLS');
  assert.equal(normalize('Café-42'), 'CAFE42');
});

test('importing keeps no answer in the clear, and checks what it is given', () => {
  const hunt = importHunt(SAMPLE);
  const text = JSON.stringify({ ...hunt, key: '' });
  for (const answer of ['TESTDOOR', 'FIRSTANSWER', 'SECOND']) assert.ok(!text.includes(answer), `${answer} is only in the map's key`);
  assert.equal(hunt.key, 'TESTDOORFIRSTANSWERSECOND');
  assert.throws(() => importHunt({ ...SAMPLE, stages: [{ ...SAMPLE.stages[0], id: 'door' }] }), /id/);
  assert.throws(() => importHunt({ ...SAMPLE, door: 'ab' }), /answer/);
  assert.throws(() => importHunt({ ...SAMPLE, signal: { cards: [{ channel: 'mtv', text: 'X' }] } }), /channel/);
  assert.throws(() => importHunt({ ...SAMPLE, stages: [SAMPLE.stages[1], SAMPLE.stages[0]] }), /day/);
  assert.throws(() => importHunt({ ...SAMPLE, final: { ...SAMPLE.final, body: [{ img: 'data:image/gif;base64,AAAA', alt: 'x' }] } }), /img/);
  // Importing again keeps the salt (printed codes still work) and what an admin set.
  const again = importHunt(SAMPLE, { ...hunt, coords: COORDS, live: true, startsAt: 'x' });
  assert.equal(again.salt, hunt.salt);
  assert.deepEqual(again.coords, COORDS);
});

test('each page shows only once the one before is solved and its day has come', () => {
  const hunt = { ...newHunt(), coords: COORDS };
  const at = (days) => START + days * DAY_MS + 1000;
  assert.deepEqual(viewFor(hunt, null, START - 1).steps, [], 'nothing before the start');
  assert.deepEqual(viewFor(hunt, { solved: ['door'] }, at(1)).steps.map((s) => s.id), ['door'], 'stage 1 waits for its day');
  assert.ok(viewFor(hunt, { solved: ['door'] }, at(1)).next.opensAt);
  assert.deepEqual(viewFor(hunt, { solved: ['door'] }, at(8)).steps.map((s) => s.id), ['door', 'radio']);
  assert.deepEqual(viewFor(hunt, { solved: ['door', 'radio'] }, at(8)).steps.map((s) => s.id), ['door', 'radio'], 'solving early still waits');
  const done = viewFor(hunt, { solved: ['door', 'radio', 'shares'] }, at(30));
  assert.deepEqual(done.steps.map((s) => s.id), ['door', 'radio', 'shares', 'final']);
  assert.ok(done.steps[3].map && !done.steps[3].note, 'the note only after the geochecker');
  assert.equal(viewFor(hunt, { solved: ['door', 'radio', 'shares', 'final'] }, at(30)).steps[3].note, 'Under the bench.');
  assert.deepEqual(viewFor(hunt, { solved: ['door'] }, at(8)).steps[1].hints, []);
  assert.deepEqual(viewFor(hunt, { solved: ['door'] }, at(11)).steps[1].hints, ['Listen.'], 'hints come out over time');
  assert.equal(viewFor(hunt, null, START - 1, { preview: true }).steps.length, 4, 'admins can preview it all');
  assert.ok(!JSON.stringify(viewFor(hunt, { solved: ['door', 'radio', 'shares', 'final'] }, at(30))).includes('hash'), 'no hashes go out');
});

test('intermissions are rare, unpredictable and the same for everyone', () => {
  const hunt = newHunt();
  const minute0 = Math.ceil(START / 60000);
  let aired = 0;
  for (let m = minute0; m < minute0 + 3000; m++) {
    const air = intermission(hunt, 'trusty', m, m * 60000);
    if (!air) continue;
    aired += 1;
    assert.deepEqual(air.card, { text: 'ABCD', mark: 'I' });
    assert.ok(air.at >= m * 60000 && air.at < (m + 1) * 60000);
    assert.deepEqual(intermission(hunt, 'trusty', m, m * 60000), air);
  }
  assert.ok(aired > 800 && aired < 1200, `about one in 3 minutes (${aired} of 3000)`);
  assert.equal(intermission(hunt, 'spongebob', minute0, START), null, 'a channel with no card has none');
  assert.equal(intermission({ ...hunt, live: false }, 'trusty', minute0, START), null);
  const other = newHunt();
  const differs = Array.from({ length: 200 }, (_, i) => Boolean(intermission(hunt, 'trusty', minute0 + i, START)) !== Boolean(intermission(other, 'trusty', minute0 + i, START)));
  assert.ok(differs.some(Boolean), 'a new seed, new times');
});

test('the radio broadcast fades out away from its frequency', () => {
  const stage = newHunt().stages[0];
  assert.equal(broadcastAt(stage, 99.9).strength, 1);
  assert.ok(broadcastAt(stage, 100.1).strength < 1);
  assert.equal(broadcastAt(stage, 100.3), null);
  assert.equal(broadcastAt(newHunt().stages[1], 99.9), null);
});

test('the map deals the coordinates with the answers and reads back with them', () => {
  for (const coords of [COORDS, { lat: -33.8568, lng: 151.21529 }, { lat: 0.00001, lng: -0.5 }, { lat: 89.99999, lng: 179.99999 }]) {
    const hunt = { ...newHunt(), coords };
    const map = mapOf(hunt);
    assert.equal(map[0].whole.length, 2);
    assert.equal(map[1].whole.length, 3);
    assert.equal(map[0].frac.length + map[1].frac.length, 10);
    assert.deepEqual(readMap(map, hunt.key), coords);
    assert.notDeepEqual(readMap(map, 'WRONGKEY'), coords);
  }
  assert.deepEqual(coordDigits(COORDS).lng, { hemi: 'W', whole: '080', frac: '76130' });
});

test('distances on the globe', () => {
  assert.ok(Math.abs(distance(COORDS, { lat: 35.20575, lng: -80.7613 })) < 0.01);
  const metersPerDegree = distance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(metersPerDegree - 111195) < 10);
});

test('codes are easy to read and hard to guess', () => {
  const codes = new Set(Array.from({ length: 500 }, newCode));
  assert.equal(codes.size, 500);
  for (const code of codes) assert.match(code, /^[ACDEFHJKMNPRTUVWXY3479]{4}-[ACDEFHJKMNPRTUVWXY3479]{4}-[ACDEFHJKMNPRTUVWXY3479]{4}$/);
});

/* ---------- The whole hunt, through the API ---------- */

const admin = { userId: 'a1', username: 'carson' };
const alice = { userId: 'u1', username: 'alice' };
const bob = { userId: 'u2', username: 'bob' };

async function setUp() {
  const store = memoryHunt();
  const as = (user, extra = {}) => (method, body, query = {}) => handle(store, { method, body, query, user, admin: user === admin, ip: user ? user.userId : 'anon', ...extra });
  await as(admin)('POST', { do: 'import', hunt: SAMPLE });
  await as(admin)('POST', { do: 'launch', startsAt: new Date(START).toISOString(), live: true });
  return { store, as };
}

test('only admins can import, launch and make codes', async () => {
  const { as } = await setUp();
  const [status] = await as(alice)('POST', { do: 'import', hunt: SAMPLE });
  assert.notEqual(status, 200);
  assert.equal((await as(alice)('GET', null, { do: 'admin' }))[0], 403);
  const [, status2] = await as(admin)('GET', null, { do: 'admin' });
  assert.equal(status2.hunt.title, 'Test Hunt');
  assert.ok(!JSON.stringify(status2).includes('FIRSTANSWER'));
});

test('a wrong door is a 404, the right one lets you in and pays once', async () => {
  const { as } = await setUp();
  const now = START + 1000;
  assert.equal((await as(alice, { now })('POST', { do: 'door', slug: 'nope' }))[0], 404);
  assert.equal((await as(alice, { now: START - 1000 })('POST', { do: 'door', slug: 'test-door' }))[0], 404, 'not before the start');
  assert.equal((await as(alice, { now })('GET'))[0], 404, 'the Hayloft is hidden until you find the door');
  const [, guest] = await as(null, { now })('POST', { do: 'door', slug: 'TEST DOOR' });
  assert.deepEqual(guest, { ok: true, login: true });
  const [status, inside] = await as(alice, { now })('POST', { do: 'door', slug: 'testdoor' });
  assert.equal(status, 200);
  assert.equal(inside.reward.added, 100);
  const [, again] = await as(alice, { now })('POST', { do: 'door', slug: 'testdoor' });
  assert.equal(again.reward, null, 'paid once');
  assert.equal((await as(alice, { now })('GET'))[0], 200);
});

test('too many wrong doors from one address are turned away', async () => {
  const { as } = await setUp();
  for (let i = 0; i < 60; i++) await as(null, { now: START + 1000 })('POST', { do: 'door', slug: `guess${i}` });
  assert.equal((await as(null, { now: START + 1000 })('POST', { do: 'door', slug: 'testdoor' }))[0], 429);
});

test('answers, the geochecker and the box, start to finish', async () => {
  const { store, as } = await setUp();
  const at = (days) => START + days * DAY_MS + 1000;
  await as(alice, { now: at(0) })('POST', { do: 'door', slug: 'testdoor' });
  assert.equal((await as(alice, { now: at(1) })('POST', { do: 'answer', stage: 'radio', answer: 'first answer' }))[0], 409, 'not open yet');
  // The radio only plays for players who've reached its stage.
  assert.equal((await as(bob, { now: at(8) })('GET', null, { do: 'radio', mhz: '99.9' }))[1].broadcast, null);
  assert.deepEqual((await as(alice, { now: at(8) })('GET', null, { do: 'radio', mhz: '99.9' }))[1].broadcast.lines, ['one', 'two']);
  assert.equal((await as(alice, { now: at(8) })('GET', null, { do: 'radio', mhz: '95.0' }))[1].broadcast, null);
  assert.deepEqual((await as(alice, { now: at(8) })('POST', { do: 'answer', stage: 'radio', answer: 'wrong' }))[1], { ok: false });
  assert.equal((await as(alice, { now: at(8) })('POST', { do: 'answer', stage: 'shares', answer: 'SECOND' }))[0], 409, 'no skipping ahead');
  const [, right] = await as(alice, { now: at(8) })('POST', { do: 'answer', stage: 'radio', answer: 'First Answer.' });
  assert.ok(right.ok);
  assert.equal(right.hayloft.steps.at(-1).id, 'radio');
  assert.ok(right.hayloft.next.opensAt, 'the next page is on its way');
  await as(alice, { now: at(15) })('POST', { do: 'answer', stage: 'shares', answer: 'second' });

  // The map waits for its coordinates.
  assert.equal((await as(alice, { now: at(22) })('POST', { do: 'check', ...COORDS }))[0], 409);
  await as(admin)('POST', { do: 'coords', ...COORDS });
  const [, hayloft] = await as(alice, { now: at(22) })('GET');
  const map = hayloft.steps.at(-1).map;
  assert.deepEqual(readMap(map, 'TESTDOORFIRSTANSWERSECOND'), COORDS, 'solvers can read it with their answers');
  assert.equal(hayloft.checks, CHECKS.perAccount);

  const far = { lat: COORDS.lat + 0.001, lng: COORDS.lng };
  for (let i = CHECKS.perAccount - 1; i >= 0; i--) {
    assert.deepEqual((await as(alice, { now: at(22) })('POST', { do: 'check', ...far }))[1], { ok: false, checks: i });
  }
  assert.equal((await as(alice, { now: at(22) })('POST', { do: 'check', ...COORDS }))[0], 429, 'three tries a day');
  const [, found] = await as(alice, { now: at(23) })('POST', { do: 'check', lat: COORDS.lat + 0.0001, lng: COORDS.lng });
  assert.ok(found.ok, 'within the radius counts');
  assert.equal(found.hayloft.steps.at(-1).note, 'Under the bench.');

  // The box.
  const [, made] = await as(admin)('POST', { do: 'codes', count: 3 });
  const [c1, c2, c3] = made.codes;
  assert.equal(made.hunt.codes.total, 3);
  assert.equal((await as(bob)('POST', { do: 'redeem', code: 'AAAA-AAAA-AAAA' }))[0], 404);
  const [, first] = await as(bob)('POST', { do: 'redeem', code: c1.toLowerCase() });
  assert.deepEqual(first, { ok: true, first: true, reward: { added: 5000, clicks: 5000 } });
  assert.equal((await as(bob)('POST', { do: 'redeem', code: c2 }))[0], 409, 'one card each');
  assert.equal((await as(alice)('POST', { do: 'redeem', code: c1 }))[0], 409, 'a card only once');
  const [, second] = await as(alice)('POST', { do: 'redeem', code: c3.replace(/-/g, ' ') });
  assert.equal(second.first, false);
  assert.equal(second.reward.added, 500);
  const [, status] = await as(admin)('GET', null, { do: 'admin' });
  assert.equal(status.hunt.firstFinder, 'bob');
  assert.deepEqual(status.hunt.finders, ['bob', 'alice']);
  assert.ok(status.hunt.mapOk);
  assert.deepEqual(status.hunt.codes, { total: 3, used: 2 });
  await as(admin)('POST', { do: 'void' });
  assert.equal((await as(admin)('GET', null, { do: 'admin' }))[1].hunt.codes.total, 2, 'unused cards stop working');
  assert.ok((await store.progress('u1')).found);
});

test('Trusty TV only gets intermissions for about now, and they can be cached', async () => {
  const { as } = await setUp();
  const now = START + 10 * 60000;
  const m = Math.floor(now / 60000);
  assert.equal((await as(null, { now })('GET', null, { do: 'tv', ch: 'trusty', m: String(m + 30) }))[0], 400);
  const [status, body, cache] = await as(null, { now })('GET', null, { do: 'tv', ch: 'trusty', m: String(m) });
  assert.equal(status, 200);
  assert.equal(body.on, true);
  assert.equal(cache, 'public');
  assert.deepEqual((await as(null, { now: START - 60000 })('GET', null, { do: 'tv', ch: 'trusty', m: String(Math.floor((START - 60000) / 60000)) }))[1], { on: false });
  assert.equal((await as(alice, { now })('GET', null, { do: 'tv', test: '1', ch: 'trusty' }))[0], 403);
  assert.ok((await as(admin, { now })('GET', null, { do: 'tv', test: '1', ch: 'trusty' }))[1].air);
});
