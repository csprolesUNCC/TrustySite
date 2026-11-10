// Trusty Fever online: the step protocol (scripts/fever-net.js), the room (realtime/room.js), tickets
// (utils/fever-ticket.js) and the ?action=fever endpoint (utils/fever-online.js).
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../scripts/fever-engine.js';
import { createEncoder, createMirror, applyStep } from '../scripts/fever-net.js';
import { Room, cleanSetup, versionProblem, CLOSE, IDLE_MS, MAX_PEOPLE, ROOM_CODE, CODE_LETTERS } from '../realtime/room.js';
import { mockBank } from '../tools/mock-bank.mjs';
import { PROTOCOL } from '../scripts/fever-net.js';
import { signTicket, verifyTicket, TICKET_SECONDS } from '../utils/fever-ticket.js';
import feverOnline from '../utils/fever-online.js';
import jwt from 'jsonwebtoken';

// The same seeded random numbers (mulberry32) as tests/fever-engine.test.js.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wire = (x) => JSON.parse(JSON.stringify(x)); // what actually travels

function distToSegment(px, py, [x0, y0, x1, y1]) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function sameAsMatch(mirror, match, at) {
  assert.equal(mirror.phase, match.phase, `phase at step ${at}`);
  assert.equal(mirror.round, match.round, `round at step ${at}`);
  assert.equal(mirror.wrapLeft, match.wrapLeft, `walls at step ${at}`);
  match.players.forEach((p, i) => {
    const m = mirror.players[i];
    for (const key of ['alive', 'ghost', 'flip', 'square', 'score']) assert.equal(m[key], p[key], `${key} of ${p.name} at step ${at}`);
    assert.ok(Math.abs(m.x - p.x) <= 0.051 && Math.abs(m.y - p.y) <= 0.051, `position of ${p.name} at step ${at}`);
    assert.ok(Math.abs(m.r - p.r) <= 0.03, `width of ${p.name} at step ${at}`);
  });
  assert.equal(mirror.powerups.length, match.powerups.length, `power-ups at step ${at}`);
  for (const pu of match.powerups) {
    assert.ok(mirror.powerups.some((o) => o.kind === pu.kind && Math.abs(o.x - pu.x) <= 0.051 && Math.abs(o.y - pu.y) <= 0.051), `${pu.kind} at step ${at}`);
  }
}

test('a page rebuilds the whole match from the steps the server sends', () => {
  const random = seeded(3);
  const match = createMatch({ humans: 2, bots: 4, skill: 'hard', powerups: true, length: 5 }, { random, readySteps: 5, firstReadySteps: 5, endSteps: 5 });
  match.begin();
  const encoder = createEncoder(match);
  const { match: mirror } = createMirror(wire(encoder.snapshot()), 1);
  let late = null; // a page that joins partway through
  let lateInk = [];
  let mirrorInk = [];
  let steps = 0;
  let sent = 0;
  let checkedInk = 0;
  for (; steps < 60 * 60 * 30 && match.phase !== 'over'; steps++) {
    // The two people steer at random, changing their minds now and then.
    for (const p of match.players.slice(0, 2)) if (random() < 0.05) p.control.turn = Math.floor(random() * 3) - 1;
    const events = match.update();
    const step = encoder.step(events);
    if (!step) {
      assert.equal(events.length, 0, 'nothing to send only when nothing happened');
      continue;
    }
    sent += 1;
    const got = applyStep(mirror, wire(step));
    sameAsMatch(mirror, match, steps);
    assert.deepEqual(got.filter((e) => e.type !== 'ink').map((e) => `${e.type}:${e.id ?? ''}`), events.filter((e) => e.type !== 'ink').map((e) => `${e.type}:${e.id ?? ''}`));

    // Every point the engine drew is on a line the page draws.
    const runs = got.filter((e) => e.type === 'ink');
    for (const e of events.filter((ev) => ev.type === 'ink')) {
      const mine = runs.filter((r) => r.id === e.id);
      assert.ok(mine.every((r) => r.width === Math.round(e.width * 10) / 10));
      for (let i = 0; i < e.segs.length; i += 2) {
        assert.ok(mine.some((r) => distToSegment(e.segs[i], e.segs[i + 1], r.segs) < 0.08), `ink of player ${e.id} at step ${steps}`);
        checkedInk += 1;
      }
    }

    for (const ink of [mirrorInk, lateInk]) ink.push(...runs.map((r) => r.segs.join()));
    if (got.some((e) => e.type === 'erase' || e.type === 'round')) {
      mirrorInk = [];
      lateInk = [];
    }
    if (late) {
      applyStep(late, wire(step));
      // (Which way heads face is only sent, and drawn, before "go".)
      const seen = (m, you) => m.players.map(({ a, ...p }) => ({ ...p, a: m.phase === 'ready' ? a : 0, you: p.id === you }));
      assert.deepEqual(seen(late), seen(mirror));
    }
    if (!late && match.round === 2 && match.phase === 'play' && match.steps === 200) {
      const joined = createMirror(wire(encoder.snapshot()));
      late = joined.match;
      lateInk = joined.ink.map((r) => r.segs.join());
      assert.deepEqual(lateInk, mirrorInk, 'a page joining mid-round gets every line drawn so far');
      sameAsMatch(late, match, steps);
    }
  }
  assert.equal(match.phase, 'over', 'the match finished');
  assert.ok(late, 'someone joined partway');
  assert.equal(mirror.champion.id, match.champion.id);
  assert.ok(checkedInk > 1000);
  assert.ok(sent < steps, 'quiet steps (between rounds) send nothing');
});

/* ---------- The room ---------- */

function person(name) {
  const conn = {
    name,
    got: [],
    closed: null,
    send(text) { this.got.push(JSON.parse(text)); },
    close(code, reason) { this.closed = { code, reason }; },
    last(type) { return this.got.filter((m) => m.t === type).at(-1); },
  };
  return { conn, user: { id: `id-${name}`, name } };
}

function openRoom(...names) {
  let clock = 1000;
  let ids = 0;
  const bank = mockBank({ startingClicks: 1000, delay: 0 });
  const room = new Room('BDFG', { bank, clock: () => clock, random: seeded(9), newId: () => (++ids).toString(16).padStart(16, '0') });
  const people = names.map(person);
  for (const p of people) room.join(p.conn, p.user);
  const run = (ms) => {
    const end = clock + ms;
    while (clock < end) {
      clock += 8;
      room.tick();
    }
  };
  return { room, people, run, bank, now: () => clock };
}

test('a page and a room server only talk if they speak the same version', () => {
  assert.equal(versionProblem(String(PROTOCOL)), null);
  for (const v of [null, '', String(PROTOCOL + 1), '0']) assert.match(versionProblem(v), /reload/);
});

test('room codes are four letters that can\'t spell words', () => {
  assert.match('BDFG', ROOM_CODE);
  assert.doesNotMatch('BDF', ROOM_CODE);
  assert.doesNotMatch('BADF', ROOM_CODE);
  assert.doesNotMatch('bdfg', ROOM_CODE);
  assert.doesNotMatch(CODE_LETTERS, /[AEIOUL01]/);
});

test('a connection that floods the room gets closed', () => {
  const { room, people: [carson, luke], run } = openRoom('carson', 'luke');
  for (let i = 0; i < 90; i++) room.receive(luke.conn, JSON.stringify({ t: 'turn', v: i % 2 }));
  run(1000);
  for (let i = 0; i < 90; i++) room.receive(luke.conn, JSON.stringify({ t: 'turn', v: i % 2 }));
  assert.equal(luke.conn.closed, null, 'busy steering is fine');
  for (let i = 0; i < 20; i++) room.receive(luke.conn, '{"t":"ping"}');
  assert.equal(luke.conn.closed.code, CLOSE.flood);
  assert.deepEqual(room.people.map((p) => p.name), ['carson']);
  assert.equal(carson.conn.closed, null);
});

test('the first one in hosts, and only the host changes the setup or starts', () => {
  const { room, people: [carson, luke] } = openRoom('carson', 'luke');
  assert.equal(carson.conn.last('room').host, 'carson');
  assert.deepEqual(luke.conn.last('room').people, ['carson', 'luke']);
  room.receive(luke.conn, JSON.stringify({ t: 'setup', bots: 3, skill: 'hard', powerups: false, length: 10 }));
  room.receive(luke.conn, JSON.stringify({ t: 'start' }));
  assert.equal(room.setup.bots, 1);
  assert.equal(room.playing, false);
  room.receive(carson.conn, JSON.stringify({ t: 'setup', bots: 3, skill: 'hard', powerups: false, length: 10 }));
  assert.deepEqual(luke.conn.last('room').setup, { bots: 3, skill: 'hard', powerups: false, length: 10, stake: 0 });
  room.receive(carson.conn, JSON.stringify({ t: 'start' }));
  assert.equal(room.playing, true);
  assert.equal(carson.conn.last('match').you, 1);
  assert.equal(luke.conn.last('match').you, 2);
  assert.deepEqual(carson.conn.last('match').snap.players.map((p) => [p.name, p.human]),
    [['carson', true], ['luke', true], ['Dusty', false], ['Crusty', false], ['Gusty', false]]);
});

test('the room ignores junk, and setups have to be real ones', () => {
  const { room, people: [carson] } = openRoom('carson');
  for (const junk of ['nope', '{', 'null', '[]', '"start"', JSON.stringify({ t: 'turn', v: 5 }), JSON.stringify({ t: 'tap', v: 0 }), JSON.stringify({ t: 'setup', bots: '2' }), 'x'.repeat(400)]) {
    room.receive(carson.conn, junk);
  }
  assert.equal(room.people[0].turn, 0);
  assert.equal(room.people[0].tap, 0);
  assert.equal(room.playing, false);
  assert.equal(cleanSetup({ bots: 2, skill: 'normal', powerups: true, length: 5 }).bots, 2);
  for (const bad of [null, {}, { bots: 6, skill: 'normal', powerups: true, length: 5 }, { bots: 1.5, skill: 'normal', powerups: true, length: 5 },
    { bots: 1, skill: '__proto__', powerups: true, length: 5 }, { bots: 1, skill: 'normal', powerups: 'yes', length: 5 }, { bots: 1, skill: 'normal', powerups: true, length: 7 },
    { bots: { $gt: 0 }, skill: 'normal', powerups: true, length: 5 }]) {
    assert.equal(cleanSetup(bad), null, JSON.stringify(bad));
  }
});

test('steering reaches the right line, and the match plays out to the end', () => {
  const { room, people: [carson, luke], run } = openRoom('carson', 'luke');
  room.receive(carson.conn, JSON.stringify({ t: 'setup', bots: 0, skill: 'normal', powerups: false, length: 5 }));
  room.receive(carson.conn, JSON.stringify({ t: 'start' }));
  const { match: seenByLuke } = createMirror(luke.conn.last('match').snap, 2);
  let used = 0;
  for (const p of [carson, luke]) p.conn.got.length = 0;
  room.receive(carson.conn, JSON.stringify({ t: 'turn', v: 1 }));
  room.receive(luke.conn, JSON.stringify({ t: 'turn', v: -1 }));
  const a = room.match.players.map((p) => p.a);
  run(4000); // past "get ready"
  assert.equal(room.match.players[0].control.turn, 1);
  assert.equal(room.match.players[1].control.turn, -1);
  // Turning keeps changing the angle (it's wrapped to ±π, so compare as a turn amount).
  const turned = (i) => Math.atan2(Math.sin(room.match.players[i].a - a[i]), Math.cos(room.match.players[i].a - a[i]));
  if (room.match.players[0].alive) assert.notEqual(turned(0), 0);
  // Both people get the same steps, in order, and they rebuild the server's match.
  assert.deepEqual(carson.conn.got.filter((m) => m.t === 'steps'), luke.conn.got.filter((m) => m.t === 'steps'));
  for (const m of luke.conn.got.filter((x) => x.t === 'steps')) for (const s of m.s) { applyStep(seenByLuke, s); used += 1; }
  assert.ok(used > 60);
  assert.deepEqual(seenByLuke.players.map((p) => [p.alive, p.score]), room.match.players.map((p) => [p.alive, p.score]));

  room.receive(carson.conn, JSON.stringify({ t: 'turn', v: 0 }));
  room.receive(luke.conn, JSON.stringify({ t: 'turn', v: 0 }));
  run(60 * 60 * 1000);
  assert.equal(room.playing, false, 'the game ended');
  const over = carson.conn.got.filter((m) => m.t === 'steps').flatMap((m) => m.s).flatMap((s) => s.e || []).find((e) => e.type === 'gameOver');
  assert.ok(over, 'everyone heard who won');
  assert.equal(carson.conn.last('room').playing, false);
});

test('a host alone gets a computer to play, and nobody gets more than six lines', () => {
  const { room, people: [carson] } = openRoom('carson');
  room.receive(carson.conn, JSON.stringify({ t: 'setup', bots: 0, skill: 'easy', powerups: true, length: 5 }));
  room.receive(carson.conn, JSON.stringify({ t: 'start' }));
  assert.equal(room.match.players.length, 2);
  const big = openRoom('a', 'b', 'c', 'd', 'e');
  big.room.receive(big.people[0].conn, JSON.stringify({ t: 'setup', bots: 5, skill: 'easy', powerups: true, length: 5 }));
  big.room.receive(big.people[0].conn, JSON.stringify({ t: 'start' }));
  assert.equal(big.room.match.players.length, MAX_PEOPLE);
});

test('a full room, a taken code and a second tab', () => {
  const { room, people } = openRoom('a', 'b', 'c', 'd', 'e', 'f');
  const g = person('g');
  assert.equal(room.join(g.conn, g.user), false);
  assert.equal(g.conn.closed.code, CLOSE.full);
  assert.match(g.conn.last('error').message, /full/);

  const h = person('h');
  assert.equal(room.join(h.conn, h.user, { make: true }), false);
  assert.equal(h.conn.closed.code, CLOSE.taken);

  // The same account again takes over its place (and the old tab is told why it closed).
  const again = person('a');
  assert.equal(room.join(again.conn, again.user), true);
  assert.equal(people[0].conn.closed.code, CLOSE.replaced);
  room.leave(people[0].conn); // the old tab's close arriving later changes nothing
  assert.equal(room.people.length, 6);
  assert.equal(room.people[0].conn, again.conn);
  assert.equal(again.conn.last('room').host, 'a');
});

test('the host leaving hands over the room; everyone playing leaving ends the match', () => {
  const { room, people: [carson, luke] } = openRoom('carson', 'luke');
  room.receive(carson.conn, JSON.stringify({ t: 'start' }));
  room.leave(carson.conn);
  assert.equal(luke.conn.last('room').host, 'luke');
  assert.equal(room.playing, true, 'luke is still playing');

  // Someone who loses their connection gets their seat back.
  const back = person('carson');
  room.join(back.conn, back.user);
  assert.equal(back.conn.last('match').you, 1);

  // A latecomer watches.
  const late = person('hayhound');
  room.join(late.conn, late.user);
  assert.equal(late.conn.last('match').you, 0);

  room.leave(back.conn);
  room.leave(luke.conn);
  assert.equal(room.playing, false, 'nobody left who was playing');
  assert.equal(late.conn.last('room').playing, false);
  assert.equal(late.conn.last('room').host, 'hayhound');
});

test('rooms with nobody playing close after a while', () => {
  const { room, people: [carson], run } = openRoom('carson');
  assert.ok(room.tickEvery() > 0);
  run(IDLE_MS - 20000);
  assert.equal(carson.conn.closed, null);
  run(30000);
  assert.equal(carson.conn.closed.code, CLOSE.idle);
  assert.equal(room.people.length, 0);
  assert.equal(room.tickEvery(), 0);
});

/* ---------- Stakes ---------- */

const settled = () => new Promise((r) => setTimeout(r, 20));
const clicks = (bank, p) => bank.account(p.user.id).clicks;

test('a staked game: everyone pays in, and the best person takes the pot', async () => {
  const { room, people: [carson, luke, hay], run, bank } = openRoom('carson', 'luke', 'hayhound');
  room.receive(carson.conn, JSON.stringify({ t: 'setup', bots: 1, skill: 'easy', powerups: false, length: 5, stake: 100 }));
  assert.equal(luke.conn.last('room').setup.stake, 100);
  await room.receive(carson.conn, JSON.stringify({ t: 'start' }));
  assert.equal(room.playing, true);
  assert.deepEqual([carson, luke, hay].map((p) => clicks(bank, p)), [900, 900, 900]);
  assert.deepEqual(luke.conn.last('match').pot, { amount: 100, total: 300 });
  for (let t = 0; room.playing && t < 3600; t++) run(1000);
  assert.equal(room.playing, false);
  await settled();
  const pot = carson.conn.last('pot');
  assert.equal(pot.total, 300);
  const total = [carson, luke, hay].reduce((sum, p) => sum + clicks(bank, p), 0);
  assert.equal(total, 3000, 'no clicks made or lost: the pot just moved');
  for (const w of pot.winners) assert.ok(['carson', 'luke', 'hayhound'].includes(w.name), 'a person, never a computer');
  assert.ok(carson.conn.last('bank'), 'everyone hears their new total');
});

test('a stake someone can’t cover stops the game, and everyone else gets theirs back', async () => {
  const { room, people: [carson, luke], bank } = openRoom('carson', 'luke');
  bank.account(luke.user.id).clicks = 30;
  room.receive(carson.conn, JSON.stringify({ t: 'setup', bots: 0, skill: 'easy', powerups: false, length: 5, stake: 50 }));
  await room.receive(carson.conn, JSON.stringify({ t: 'start' }));
  assert.equal(room.playing, false);
  assert.match(luke.conn.last('notice').message, /only have 30/);
  assert.match(carson.conn.last('notice').message, /luke couldn’t put in 50 clicks/);
  await settled();
  assert.equal(clicks(bank, carson), 1000);
  assert.equal(clicks(bank, luke), 30);
});

test('a staked game everyone playing leaves is called off: stakes come back', async () => {
  const { room, people: [carson, luke], bank } = openRoom('carson', 'luke');
  room.receive(carson.conn, JSON.stringify({ t: 'setup', bots: 0, skill: 'easy', powerups: false, length: 5, stake: 500 }));
  await room.receive(carson.conn, JSON.stringify({ t: 'start' }));
  const late = person('hayhound');
  room.join(late.conn, late.user);
  room.leave(carson.conn);
  room.leave(luke.conn);
  await settled();
  assert.deepEqual([clicks(bank, carson), clicks(bank, luke)], [1000, 1000]);
  assert.equal(late.conn.last('pot').refund, true);
});

test('stakes need two people: alone, the host just plays', async () => {
  const { room, people: [carson], bank } = openRoom('carson');
  room.receive(carson.conn, JSON.stringify({ t: 'setup', bots: 1, skill: 'easy', powerups: false, length: 5, stake: 100 }));
  room.receive(carson.conn, JSON.stringify({ t: 'start' }));
  assert.equal(room.playing, true);
  assert.equal(carson.conn.last('match').pot, null);
  assert.equal(clicks(bank, carson), 1000);
  assert.equal(cleanSetup({ bots: 1, skill: 'easy', powerups: false, length: 5, stake: 99 }), null, 'only the listed stakes');
});

/* ---------- Tickets ---------- */

const SECRET = 'a-test-secret-that-is-long-enough-1234';

test('tickets: signed, checked, and only good for a minute', async () => {
  const now = Date.now();
  const ticket = await signTicket({ id: 'abc123', name: 'trusty_fan' }, SECRET, now);
  assert.deepEqual(await verifyTicket(ticket, SECRET, now), { id: 'abc123', name: 'trusty_fan' });
  assert.deepEqual(await verifyTicket(ticket, SECRET, now + (TICKET_SECONDS - 1) * 1000), { id: 'abc123', name: 'trusty_fan' });
  assert.equal(await verifyTicket(ticket, SECRET, now + (TICKET_SECONDS + 1) * 1000), null, 'expired');
  assert.equal(await verifyTicket(ticket, `${SECRET}x`, now), null, 'another secret');
  assert.equal(await verifyTicket(ticket, 'short', now), null, 'a weak secret is never trusted');

  // Anything changed in the payload breaks the signature.
  const [payload, signature] = ticket.split('.');
  const forged = Buffer.from(JSON.stringify({ id: 'abc123', name: 'luke', exp: Math.floor(now / 1000) + 60 })).toString('base64url');
  assert.equal(await verifyTicket(`${forged}.${signature}`, SECRET, now), null);
  for (const junk of [null, 42, {}, '', '.', 'a.b.c', `${payload}.`, `${payload}.***`, 'x'.repeat(2000)]) {
    assert.equal(await verifyTicket(junk, SECRET, now), null, String(junk));
  }

  // Names that aren't plain ASCII survive the trip.
  const unicode = await signTicket({ id: '1', name: 'pferd_ü' }, SECRET, now);
  assert.equal((await verifyTicket(unicode, SECRET, now)).name, 'pferd_ü');
});

/* ---------- ?action=fever ---------- */

function call(handler, { method = 'GET', cookie } = {}) {
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return Promise.resolve(handler({ method, query: { action: 'fever' }, headers: cookie ? { cookie } : {}, body: {} }, res)).then(() => res);
}

test('?action=fever: off until both settings are there, then tickets for logged-in players', async () => {
  delete process.env.FEVER_ROOMS_URL;
  delete process.env.FEVER_SECRET;
  assert.deepEqual((await call(feverOnline)).body, { rooms: null });
  const cookie = `authToken=${jwt.sign({ userId: 'u1', username: 'carson' }, process.env.JWT_SECRET)}`;
  assert.equal((await call(feverOnline, { method: 'POST', cookie })).statusCode, 503);

  process.env.FEVER_ROOMS_URL = 'wss://trusty-fever.example.workers.dev/';
  process.env.FEVER_SECRET = SECRET;
  const status = await call(feverOnline);
  assert.deepEqual(status.body, { rooms: 'wss://trusty-fever.example.workers.dev' });
  assert.match(status.headers['vercel-cdn-cache-control'], /max-age/);

  assert.equal((await call(feverOnline, { method: 'POST' })).statusCode, 401);
  assert.equal((await call(feverOnline, { method: 'POST', cookie: 'authToken=not-a-token' })).statusCode, 401);
  const got = await call(feverOnline, { method: 'POST', cookie });
  assert.equal(got.statusCode, 200);
  assert.deepEqual(await verifyTicket(got.body.ticket, SECRET), { id: 'u1', name: 'carson' });
  assert.equal(got.headers['cache-control'], 'no-store');

  // Settings that would leak tickets or be easy to forge keep it off.
  process.env.FEVER_ROOMS_URL = 'ws://insecure.example';
  assert.deepEqual((await call(feverOnline)).body, { rooms: null });
  process.env.FEVER_ROOMS_URL = 'wss://trusty-fever.example.workers.dev';
  process.env.FEVER_SECRET = 'too-short';
  assert.deepEqual((await call(feverOnline)).body, { rooms: null });
  delete process.env.FEVER_ROOMS_URL;
  delete process.env.FEVER_SECRET;
});
