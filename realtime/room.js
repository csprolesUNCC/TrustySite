// One Trusty Fever online room: who's in it, the host's setup, and the match itself (scripts/fever-engine.js,
// run here so every player sees the same game). It knows nothing about where it runs: realtime/worker.js (one
// Cloudflare Durable Object per room) and tools/local-rooms.mjs hand it connections ({ send(text),
// close(code, reason) }) and a click bank (realtime/bank.js), and call tick() every tickEvery() ms. `clock`,
// `random` and `newId` are only there for the tests.
//
// Messages are JSON. From a player: { t: 'turn', v: -1 | 0 | 1 } when their steering changes, { t: 'tap',
// v: -1 | 1 } for a fresh press (square turns), { t: 'ping' }, and from the host only { t: 'setup', bots, skill,
// powerups, length, stake } and { t: 'start' }. To players: { t: 'room' } whenever who's in, the host, the setup
// or whether a match is on changes; { t: 'match', you, snap, pot } when a match starts or they join one partway;
// { t: 'steps', s } with the steps run since the last tick (scripts/fever-net.js); { t: 'pot', total, winners }
// when a staked game is paid out; { t: 'bank', clicks, net } when their clicks change; { t: 'notice', message };
// { t: 'pong' }; and { t: 'error', message } just before the room closes their connection.
//
// Stakes: the host can ask everyone to put in the same number of clicks (`stake`). Everyone playing pays it
// before the game starts, or the game doesn't start; the best-placed person takes the pot (computers can't win
// clicks, and a tie splits it); a game nobody playing stays for gives everyone their stake back.
import { createMatch, PLAYERS, SKILLS } from '../scripts/fever-engine.js';
import { createEncoder, ROOM_CODE, CODE_LETTERS, PROTOCOL } from '../scripts/fever-net.js';
import { CLOSE, send, refuse, flooding, parse, randomId } from './common.js';
import { noBank } from './bank.js';

export { ROOM_CODE, CODE_LETTERS, CLOSE };
export const MAX_PEOPLE = PLAYERS.length;
export const IDLE_MS = 15 * 60 * 1000; // a room with no game for this long closes
export const STAKES = [0, 10, 50, 100, 500];
export const DEFAULT_SETUP = { bots: 1, skill: 'normal', powerups: true, length: 5, stake: 0 };

const STEP_MS = 1000 / 60;
const FAST_FORWARD = 8; // steps per step once every person is out, as in the local game
const MAX_BURST = 10;   // steps a late timer catches up on at once; past that the game just runs a bit slow
const LENGTHS = [5, 10, 15];
const MAX_MESSAGE = 300;

// Why a page can't use this room server (an older or newer copy of the game), or null if it can. Pages say
// which PROTOCOL they speak in the connection's ?v=.
export function versionProblem(v) {
  return v === String(PROTOCOL) ? null : 'Online Trusty Fever was just updated: reload the page to play.';
}

// The host's setup, if it's a real one.
export function cleanSetup(s) {
  if (!s || typeof s !== 'object') return null;
  const { bots, skill, powerups, length, stake = 0 } = s;
  if (!Number.isInteger(bots) || bots < 0 || bots > MAX_PEOPLE - 1) return null;
  if (typeof skill !== 'string' || !Object.hasOwn(SKILLS, skill)) return null;
  if (typeof powerups !== 'boolean' || !LENGTHS.includes(length) || !STAKES.includes(stake)) return null;
  return { bots, skill, powerups, length, stake };
}

export class Room {
  constructor(code, { bank = noBank, clock = Date.now, random = Math.random, newId = randomId } = {}) {
    Object.assign(this, { code, bank, clock, random, newId });
    this.people = [];      // connected: { conn, id, name, turn, tap }, in the order they came in
    this.hostId = null;
    this.setup = { ...DEFAULT_SETUP };
    this.match = null;
    this.encoder = null;
    this.seats = [];       // ids of the people in the match, in player order (player 1 first)
    this.playing = false;
    this.starting = false; // collecting stakes
    this.pot = null;       // { potId, amount, stakes: [{ userId, betId }] } while a staked game is on
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
    if (this.playing && !this.seats.some((id) => this.people.some((p) => p.id === id))) this.stop({ refund: true });
    this.sendRoom();
  }

  // Returns a promise when it starts a staked game (the bank takes a moment), so the server can wait for it.
  receive(conn, data) {
    const person = this.people.find((p) => p.conn === conn);
    if (!person) return undefined;
    if (flooding(person, this.clock())) {
      this.leave(conn);
      refuse(conn, CLOSE.flood, 'Too many messages: reload the page to play again.');
      return undefined;
    }
    const msg = parse(data, MAX_MESSAGE);
    if (!msg) return undefined;
    if (msg.t === 'turn') {
      if (msg.v === -1 || msg.v === 0 || msg.v === 1) person.turn = msg.v;
    } else if (msg.t === 'tap') {
      if (msg.v === -1 || msg.v === 1) person.tap = msg.v;
    } else if (msg.t === 'ping') {
      send(conn, { t: 'pong' });
    } else if (person.id === this.hostId && !this.playing && !this.starting) {
      if (msg.t === 'setup') {
        const setup = cleanSetup(msg);
        if (!setup) return undefined;
        this.setup = setup;
        this.quietSince = this.clock();
        this.sendRoom();
      } else if (msg.t === 'start') {
        return this.start();
      }
    }
    return undefined;
  }

  start() {
    const players = this.people.slice(0, MAX_PEOPLE);
    // A stake needs someone to lose it to.
    if (this.setup.stake && players.length > 1) return this.collect(players, this.setup.stake);
    this.begin(players, null);
    return undefined;
  }

  // Everyone playing puts in the stake, or nobody does.
  async collect(players, amount) {
    this.starting = true;
    this.sendRoom();
    const stakes = players.map((p) => ({ userId: p.id, betId: this.newId() }));
    const answers = await Promise.all(stakes.map((s) => this.bank.stake({ ...s, amount, game: 'fever' })));
    this.starting = false;
    const paid = stakes.filter((_, i) => answers[i].ok);
    const stayed = players.some((p) => this.people.includes(p));
    if (paid.length < stakes.length || !stayed) {
      if (paid.length) this.bank.settle(paid.map((s) => ({ ...s, payout: amount }))).then((r) => this.tellBalances(r));
      // Whoever couldn't pay hears why from the bank; everyone else hears who.
      const short = players.filter((_, i) => !answers[i].ok);
      for (const [i, p] of players.entries()) if (!answers[i].ok) send(p.conn, { t: 'notice', message: answers[i].error });
      const message = `The game didn’t start: ${short.map((p) => p.name).join(', ')} couldn’t put in ${amount} clicks.`;
      if (short.length) for (const p of this.people) if (!short.includes(p)) send(p.conn, { t: 'notice', message });
      this.quietSince = this.clock();
      this.sendRoom();
      return;
    }
    players.forEach((p, i) => send(p.conn, { t: 'bank', clicks: answers[i].clicks, net: answers[i].net }));
    this.begin(players, { potId: this.newId(), amount, stakes });
  }

  begin(players, pot) {
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
    this.pot = pot;
    this.match.begin();
    this.encoder = createEncoder(this.match);
    this.playing = true;
    this.startedAt = this.clock();
    this.stepsRun = 0;
    this.quietSince = this.startedAt;
    this.sendRoom();
    this.sendMatch(this.people);
  }

  // Back to the lobby: the game finished (winners: the ids that share the pot), or everyone playing it left
  // (refund: everyone gets their stake back).
  stop({ winners = null, refund = false } = {}) {
    if (this.pot && (winners || refund)) {
      const names = new Map(this.seats.map((id, i) => [id, this.match.players[i].name]));
      this.payPot(this.pot, winners || this.pot.stakes.map((s) => s.userId), names);
    }
    this.playing = false;
    this.match = null;
    this.encoder = null;
    this.seats = [];
    this.pot = null;
    this.quietSince = this.clock();
  }

  tick() {
    const now = this.clock();
    if (!this.playing) {
      if (this.people.length && !this.starting && now - this.quietSince >= IDLE_MS) this.closeAll(CLOSE.idle, 'This room closed after 15 minutes without a game.');
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
      this.stop({ winners: this.bestPeople() });
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

  // The people (not computers) with the most points: who takes the pot.
  bestPeople() {
    const people = this.match.players.filter((p) => p.human);
    const best = Math.max(...people.map((p) => p.score));
    return people.filter((p) => p.score === best).map((p) => this.seats[p.id - 1]);
  }

  async payPot(pot, winners, names) {
    const answer = await this.bank.pot({ potId: pot.potId, stakes: pot.stakes, winners });
    if (!answer.ok) return; // the bank gives the stakes back by itself after a while
    const takers = (answer.payouts || []).filter((p) => p.payout > 0);
    this.broadcast({
      t: 'pot',
      total: answer.total,
      refund: takers.length === pot.stakes.length,
      winners: takers.map((p) => ({ name: names.get(p.userId) || 'someone', payout: p.payout })),
    });
    this.tellBalances(answer);
  }

  tellBalances(answer) {
    for (const p of this.people) {
      const mine = answer && answer.balances && answer.balances[p.id];
      if (mine) send(p.conn, { t: 'bank', ...mine });
    }
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
        starting: this.starting,
      });
    }
  }

  sendMatch(people) {
    const snap = JSON.stringify(this.encoder.snapshot());
    const pot = JSON.stringify(this.pot ? { amount: this.pot.amount, total: this.pot.amount * this.pot.stakes.length } : null);
    for (const p of people) send(p.conn, `{"t":"match","you":${this.seats.indexOf(p.id) + 1},"pot":${pot},"snap":${snap}}`);
  }

  closeAll(code, message) {
    const people = this.people;
    this.people = [];
    this.hostId = null;
    this.stop({ refund: true });
    for (const p of people) refuse(p.conn, code, message);
  }
}
