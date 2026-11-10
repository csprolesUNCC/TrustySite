// One Trusty Fever online room: who's in it, the host's setup, and the match itself (scripts/fever-engine.js,
// run here so every player sees the same game). It knows nothing about where it runs: realtime/worker.js (one
// Cloudflare Durable Object per room) and tools/dev-server.mjs hand it connections ({ send(text),
// close(code, reason) }) and call tick() on a timer, every tickEvery() ms. `clock` and `random` are only there
// for the tests.
//
// Messages are JSON. From a player: { t: 'turn', v: -1 | 0 | 1 } when their steering changes, { t: 'tap',
// v: -1 | 1 } for a fresh press (square turns), { t: 'ping' }, and from the host only { t: 'setup', bots, skill,
// powerups, length } and { t: 'start' }. To players: { t: 'room' } whenever who's in, the host, the setup or
// whether a match is on changes; { t: 'match', you, snap } when a match starts or they join one partway;
// { t: 'steps', s } with the steps run since the last tick (scripts/fever-net.js); { t: 'pong' }; and
// { t: 'error', message } just before the room closes their connection.
import { createMatch, PLAYERS, SKILLS } from '../scripts/fever-engine.js';
import { createEncoder, ROOM_CODE, CODE_LETTERS, PROTOCOL } from '../scripts/fever-net.js';

export { ROOM_CODE, CODE_LETTERS };
export const MAX_PEOPLE = PLAYERS.length;
export const IDLE_MS = 15 * 60 * 1000; // a room with no game for this long closes
export const CLOSE = { ticket: 4001, full: 4002, taken: 4003, replaced: 4004, idle: 4005, version: 4006, flood: 4007 };
export const DEFAULT_SETUP = { bots: 1, skill: 'normal', powerups: true, length: 5 };

const STEP_MS = 1000 / 60;
const FAST_FORWARD = 8; // steps per step once every person is out, as in the local game
const MAX_BURST = 10;   // steps a late timer catches up on at once; past that the game just runs a bit slow
const LENGTHS = [5, 10, 15];
const MAX_MESSAGE = 300;
// Steering sends a message per press and release, so even frantic play is a few dozen a second. Every message
// counts against Cloudflare's free allowance, so a connection sending far more than that gets closed.
const MAX_PER_SECOND = 100;

// Why a page can't use this room server (an older or newer copy of the game), or null if it can. Pages say
// which PROTOCOL they speak in the connection's ?v=.
export function versionProblem(v) {
  return v === String(PROTOCOL) ? null : 'Online Trusty Fever was just updated: reload the page to play.';
}

// The host's setup, if it's a real one.
export function cleanSetup(s) {
  if (!s || typeof s !== 'object') return null;
  const { bots, skill, powerups, length } = s;
  if (!Number.isInteger(bots) || bots < 0 || bots > MAX_PEOPLE - 1) return null;
  if (typeof skill !== 'string' || !Object.hasOwn(SKILLS, skill)) return null;
  if (typeof powerups !== 'boolean' || !LENGTHS.includes(length)) return null;
  return { bots, skill, powerups, length };
}

function send(conn, message) {
  conn.send(typeof message === 'string' ? message : JSON.stringify(message));
}

function refuse(conn, code, message) {
  send(conn, { t: 'error', message });
  conn.close(code, message);
  return false;
}

export class Room {
  constructor(code, { clock = Date.now, random = Math.random } = {}) {
    this.code = code;
    this.clock = clock;
    this.random = random;
    this.people = [];      // connected: { conn, id, name, turn, tap }, in the order they came in
    this.hostId = null;
    this.setup = { ...DEFAULT_SETUP };
    this.match = null;
    this.encoder = null;
    this.seats = [];       // ids of the people in the match, in player order (player 1 first)
    this.playing = false;
    this.startedAt = 0;
    this.stepsRun = 0;
    this.quietSince = clock();
  }

  // How often the room wants tick() called, in ms (0: never, nobody's here).
  tickEvery() {
    if (this.playing) return 8;
    return this.people.length ? 10000 : 0;
  }

  // user: { id, name }, already checked by whoever let the connection in. make: they're creating the room,
  // so it has to be empty.
  join(conn, user, { make = false } = {}) {
    if (make && this.people.length) return refuse(conn, CLOSE.taken, 'That room code is taken.');
    const known = this.people.find((p) => p.id === user.id);
    if (known) {
      // The same account again (another tab, or back after losing the connection): this connection takes over.
      const old = known.conn;
      Object.assign(known, { conn, name: user.name, turn: 0, tap: 0 });
      old.close(CLOSE.replaced, 'You opened this room somewhere else.');
    } else {
      // Someone who lost their connection mid-game always gets back to their seat.
      if (this.people.length >= MAX_PEOPLE && !this.seats.includes(user.id)) {
        return refuse(conn, CLOSE.full, 'That room is full: six players already.');
      }
      this.people.push({ conn, id: user.id, name: user.name, turn: 0, tap: 0, second: 0, sent: 0 });
      this.hostId ??= user.id;
    }
    this.quietSince = this.clock();
    this.sendRoom();
    if (this.playing) this.sendMatch([this.people.find((p) => p.id === user.id)]);
    return true;
  }

  leave(conn) {
    const i = this.people.findIndex((p) => p.conn === conn);
    if (i < 0) return;
    const [gone] = this.people.splice(i, 1);
    if (gone.id === this.hostId) this.hostId = this.people.length ? this.people[0].id : null;
    // A player who drops out keeps their seat (their line just goes straight) until nobody playing is left.
    if (this.playing && !this.seats.some((id) => this.people.some((p) => p.id === id))) this.stop();
    this.sendRoom();
  }

  receive(conn, data) {
    const person = this.people.find((p) => p.conn === conn);
    if (!person) return;
    const second = Math.floor(this.clock() / 1000);
    if (second !== person.second) {
      person.second = second;
      person.sent = 0;
    }
    if (++person.sent > MAX_PER_SECOND) {
      this.leave(conn);
      refuse(conn, CLOSE.flood, 'Too many messages: reload the page to play again.');
      return;
    }
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'turn') {
      if (msg.v === -1 || msg.v === 0 || msg.v === 1) person.turn = msg.v;
    } else if (msg.t === 'tap') {
      if (msg.v === -1 || msg.v === 1) person.tap = msg.v;
    } else if (msg.t === 'ping') {
      send(conn, { t: 'pong' });
    } else if (person.id === this.hostId && !this.playing) {
      if (msg.t === 'setup') {
        const setup = cleanSetup(msg);
        if (!setup) return;
        this.setup = setup;
        this.quietSince = this.clock();
        this.sendRoom();
      } else if (msg.t === 'start') {
        this.start();
      }
    }
  }

  start() {
    const players = this.people.slice(0, MAX_PEOPLE);
    const humans = players.length;
    const { skill, powerups, length } = this.setup;
    // Always at least two lines, so a host on their own gets a computer to play.
    const bots = Math.max(2 - humans, Math.min(this.setup.bots, MAX_PEOPLE - humans));
    this.match = createMatch({ humans, bots, skill, powerups, length }, { random: this.random });
    players.forEach((p, i) => {
      this.match.players[i].name = p.name;
      p.turn = 0;
      p.tap = 0;
    });
    this.seats = players.map((p) => p.id);
    this.match.begin();
    this.encoder = createEncoder(this.match);
    this.playing = true;
    this.startedAt = this.clock();
    this.stepsRun = 0;
    this.quietSince = this.startedAt;
    this.sendRoom();
    this.sendMatch(this.people);
  }

  // Back to the lobby: the game finished, or everyone playing it left.
  stop() {
    this.playing = false;
    this.match = null;
    this.encoder = null;
    this.seats = [];
    this.quietSince = this.clock();
  }

  tick() {
    const now = this.clock();
    if (!this.playing) {
      if (this.people.length && now - this.quietSince >= IDLE_MS) this.closeAll(CLOSE.idle, 'This room closed after 15 minutes without a game.');
      return;
    }
    let due = Math.floor((now - this.startedAt) / STEP_MS) - this.stepsRun;
    if (due > MAX_BURST) {
      this.stepsRun += due - MAX_BURST;
      due = MAX_BURST;
    }
    const steps = [];
    let over = false;
    for (let i = 0; i < due && !over; i++) {
      this.stepsRun += 1;
      const repeat = this.fastForward() ? FAST_FORWARD : 1;
      for (let r = 0; r < repeat && !over; r++) {
        this.steer();
        const step = this.encoder.step(this.match.update());
        if (step) steps.push(step);
        over = this.match.phase === 'over';
      }
    }
    if (steps.length) this.broadcast({ t: 'steps', s: steps });
    if (over) {
      this.stop();
      this.sendRoom();
    }
  }

  /* ---------- Inside ---------- */

  // Everyone's latest steering, into the match. A seat whose player is gone just goes straight.
  steer() {
    this.seats.forEach((id, i) => {
      const person = this.people.find((p) => p.id === id);
      const control = this.match.players[i].control;
      control.turn = person ? person.turn : 0;
      if (person && person.tap) {
        control.tap = person.tap;
        person.tap = 0;
      }
    });
  }

  // Once every person is out, the computers finish the round at 8x speed.
  fastForward() {
    const m = this.match;
    return m.phase === 'play' && this.seats.length > 0 && !m.players.some((p) => p.human && p.alive);
  }

  broadcast(message) {
    const text = JSON.stringify(message);
    for (const p of this.people) send(p.conn, text);
  }

  sendRoom() {
    const host = this.people.find((p) => p.id === this.hostId);
    for (const p of this.people) {
      send(p.conn, {
        t: 'room',
        code: this.code,
        you: p.name,
        host: host ? host.name : null,
        people: this.people.map((x) => x.name),
        setup: this.setup,
        playing: this.playing,
      });
    }
  }

  sendMatch(people) {
    const snap = JSON.stringify(this.encoder.snapshot());
    for (const p of people) send(p.conn, `{"t":"match","you":${this.seats.indexOf(p.id) + 1},"snap":${snap}}`);
  }

  closeAll(code, message) {
    const people = this.people;
    this.people = [];
    this.hostId = null;
    this.stop();
    for (const p of people) refuse(p.conn, code, message);
  }
}
