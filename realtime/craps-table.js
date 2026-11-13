// One Trusty Craps table online: up to six people bet their site clicks on the same dice. Like realtime/table.js it
// knows nothing about where it runs: realtime/worker.js (one Durable Object per table code) and
// tools/local-rooms.mjs hand it connections and a click bank (realtime/bank.js), and call tick() every
// tickEvery() ms. The rules are scripts/craps.js; the dice are rolled here.
//
// Everyone shares the dice and the point; each player has their own bets. One player is the shooter: they roll
// (at most once every TIMES.settle, so everyone sees the last roll first), and when they seven out the dice pass
// to the next seat. A shooter who doesn't roll within TIMES.shoot while there are bets on the table gets rolled
// for, and passes the dice. Bets are staked at the bank when they go down and stay on the table until the dice
// decide them, whether their player is still sitting there or not; when the last player gets up, the dice roll
// on their own until every bet is decided and paid.
//
// Messages from a player: { t: 'bet', bets: { [spot]: amount }, roll } (roll: the shooter puts these down and
// rolls), { t: 'ping' }. To players: { t: 'craps' } after every change (the point, who's shooting, everyone's bets,
// the last roll and what it did to your bets, and how long until the dice roll themselves), { t: 'bank', clicks,
// net } when their clicks change, { t: 'notice', message } when a bet didn't go down, { t: 'pong' }, and
// { t: 'error', message } before the table closes their connection.
import { BETS, SPOTS, CRAPS_PROTOCOL, cleanBets, betProblem, roll, nextPoint } from '../scripts/craps.js';
import { CLOSE, send, refuse, flooding, parse, randomId } from './common.js';
import { noBank } from './bank.js';

export const MAX_SEATS = 6;
export const TIMES = {
  settle: 3000,           // after a roll, before the shooter can roll again
  shoot: 20000,           // then how long the shooter has, while there are bets on the table
  idle: 10 * 60 * 1000,   // no bets on the table and none put down for this long, and you're up from the table
};
const HISTORY = 20;
const MAX_MESSAGE = 300;
const PLAY_OUT_ROLLS = 10000; // more than enough: every bet is decided within a few rolls on average

export function versionProblem(v) {
  return v === String(CRAPS_PROTOCOL) ? null : 'Trusty Craps was just updated: reload the page to play.';
}

const total = (bets) => Object.values(bets || {}).reduce((sum, b) => sum + b.amount, 0);
const amounts = (bets) => Object.fromEntries(Object.entries(bets || {}).map(([spot, b]) => [spot, b.amount]));

export class CrapsTable {
  constructor(code, { bank = noBank, clock = Date.now, random = Math.random, newId = randomId } = {}) {
    Object.assign(this, { code, bank, clock, random, newId });
    this.people = [];        // { conn, id, name, busy, active }
    this.names = new Map();  // id -> name, for bets whose player got up
    this.bets = new Map();   // id -> { [spot]: { id, amount } }, everyone's bets on the table
    this.point = null;
    this.shooter = null;     // the shooter's account id
    this.rolls = 0;
    this.history = [];
    this.last = null;        // { dice, point (before it), by (who rolled), auto (the dice rolled themselves) }
    this.decided = new Map(); // id -> what the last roll decided for them
    this.rollAt = 0;         // when the shooter can roll next
    this.deadline = 0;       // when the dice roll themselves (0: nothing on the table)
  }

  tickEvery() {
    return this.people.length ? 200 : 0;
  }

  // make: they're opening the table, so it has to be empty.
  join(conn, user, { make = false } = {}) {
    if (make && this.people.length) return refuse(conn, CLOSE.taken, 'That table code is taken.');
    const known = this.people.find((p) => p.id === user.id);
    if (known) {
      const old = known.conn;
      Object.assign(known, { conn, name: user.name });
      old.close(CLOSE.replaced, 'You sat down at this table somewhere else.');
    } else {
      if (this.people.length >= MAX_SEATS) return refuse(conn, CLOSE.full, 'That table is full: six players already.');
      this.people.push({ conn, id: user.id, name: user.name, busy: false, active: this.clock(), second: 0, sent: 0 });
    }
    this.names.set(user.id, user.name);
    if (!this.people.some((p) => p.id === this.shooter)) this.shooter = user.id;
    this.sendAll();
    return true;
  }

  leave(conn) {
    const i = this.people.findIndex((p) => p.conn === conn);
    if (i < 0) return;
    const [gone] = this.people.splice(i, 1);
    if (!this.people.length) {
      this.playOut();
      return;
    }
    if (gone.id === this.shooter) this.passDice(i - 1);
    this.sendAll();
  }

  // Returns a promise while the bank is being asked, so the server can wait for it.
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
    if (msg.t === 'ping') send(conn, { t: 'pong' });
    else if (msg.t === 'bet') return this.place(person, msg.bets, msg.roll === true);
    return undefined;
  }

  tick() {
    const now = this.clock();
    if (this.deadline && now >= this.deadline) {
      this.rollDice({ auto: true });
      this.sendAll();
    }
    for (const p of [...this.people]) {
      if (p.busy || this.bets.has(p.id) || now - p.active < TIMES.idle) continue;
      this.leave(p.conn);
      refuse(p.conn, CLOSE.idle, 'You got up from the table after 10 minutes without a bet.');
    }
  }

  /* ---------- Players ---------- */

  canRoll(person) {
    return person.id === this.shooter && this.clock() >= this.rollAt;
  }

  // New bets for `person`, staked at the bank (all of them, or none), then the roll if they're the shooter and
  // asked for it.
  async place(person, sent, rollAfter) {
    if (person.busy) return;
    const bets = cleanBets(sent);
    if (!bets) return;
    const mine = () => ({ point: this.point, bets: this.bets.get(person.id) || {} });
    const problem = betProblem(mine(), bets);
    if (problem) {
      send(person.conn, { t: 'notice', message: problem });
      return;
    }
    person.active = this.clock();
    const spots = SPOTS.filter((spot) => bets[spot]);
    if (spots.length) {
      const rolls = this.rolls;
      const staked = await this.charge(person, spots.map((spot) => ({ spot, id: this.newId(), amount: bets[spot] })));
      if (!staked) return;
      // The dice may have rolled, or they may have got up, while the bank was busy.
      const late = !this.people.includes(person) || (this.rolls !== rolls && betProblem(mine(), bets));
      if (late) {
        this.pay(staked.map((s) => ({ userId: person.id, betId: s.id, payout: s.amount })));
        if (this.people.includes(person)) send(person.conn, { t: 'notice', message: 'The dice rolled first. Try that again.' });
        this.sendAll();
        return;
      }
      const table = this.bets.get(person.id) || {};
      for (const { spot, id, amount } of staked) table[spot] = { id, amount };
      this.bets.set(person.id, table);
    }
    if (rollAfter && this.canRoll(person)) this.rollDice();
    else if (!this.deadline && this.bets.size) this.deadline = Math.max(this.clock(), this.rollAt) + TIMES.shoot;
    this.sendAll();
  }

  /* ---------- The dice ---------- */

  rollDice({ auto = false } = {}) {
    if (!this.bets.size) {
      this.deadline = 0;
      return;
    }
    const now = this.clock();
    const die = () => 1 + Math.floor(this.random() * 6);
    const dice = [die(), die()];
    const before = this.point;
    const paid = [];
    this.decided = new Map();
    for (const [id, bets] of this.bets) {
      const table = { point: before, bets };
      const decided = roll(table, dice);
      if (decided.length) this.decided.set(id, decided.map(({ spot, amount, result, payout }) => ({ spot, amount, result, payout })));
      for (const d of decided) paid.push({ userId: id, betId: d.id, payout: d.payout });
      if (!Object.keys(table.bets).length) this.bets.delete(id);
    }
    this.point = nextPoint(before, dice);
    this.rolls += 1;
    this.history = [...this.history, dice[0] + dice[1]].slice(-HISTORY);
    this.last = { dice, point: before, by: this.names.get(this.shooter) || null, auto };
    this.rollAt = now + TIMES.settle;
    this.deadline = this.bets.size ? this.rollAt + TIMES.shoot : 0;
    const sevenOut = before != null && dice[0] + dice[1] === 7;
    if (sevenOut || auto) this.passDice(this.people.findIndex((p) => p.id === this.shooter));
    this.pay(paid);
  }

  // The dice go to the seat after `from` (an index into people; -1 for the first seat).
  passDice(from) {
    if (!this.people.length) {
      this.shooter = null;
      return;
    }
    this.shooter = this.people[(from + 1) % this.people.length].id;
  }

  // Nobody's left at the table: roll until every bet on it is decided and paid, and start fresh.
  playOut() {
    for (let i = 0; this.bets.size && i < PLAY_OUT_ROLLS; i++) this.rollDice({ auto: true });
    Object.assign(this, { point: null, shooter: null, deadline: 0, rollAt: 0, last: null, decided: new Map() });
  }

  /* ---------- The bank ---------- */

  // Stakes these bets for `person` (they're busy meanwhile). Returns them, or null if the bank said no to any
  // (then the rest go back), and tells them why.
  async charge(person, stakes) {
    person.busy = true;
    this.sendAll();
    const done = [];
    let answer = null;
    for (const s of stakes) {
      answer = await this.bank.stake({ userId: person.id, betId: s.id, amount: s.amount, game: 'craps' });
      if (!answer.ok) break;
      done.push(s);
    }
    person.busy = false;
    if (!answer.ok) {
      this.pay(done.map((s) => ({ userId: person.id, betId: s.id, payout: s.amount })));
      send(person.conn, { t: 'notice', message: answer.error });
      this.sendAll();
      return null;
    }
    send(person.conn, { t: 'bank', clicks: answer.clicks, net: answer.net });
    return done;
  }

  async pay(bets) {
    if (!bets.length) return;
    const answer = await this.bank.settle(bets);
    for (const p of this.people) {
      const mine = answer && answer.balances && answer.balances[p.id];
      if (mine) send(p.conn, { t: 'bank', ...mine });
    }
  }

  /* ---------- What everyone sees ---------- */

  sendAll() {
    const now = this.clock();
    const shooter = this.names.get(this.shooter) || null;
    const people = this.people.map((p) => ({ name: p.name, onTable: total(this.bets.get(p.id)), busy: p.busy, shooter: p.id === this.shooter }));
    for (const person of this.people) {
      send(person.conn, {
        t: 'craps',
        code: this.code,
        you: person.name,
        point: this.point,
        shooter,
        youShoot: person.id === this.shooter,
        wait: Math.max(0, this.rollAt - now),
        left: this.deadline ? Math.max(0, this.deadline - now) : 0,
        people,
        mine: amounts(this.bets.get(person.id)),
        anyBets: this.bets.size > 0,
        rolls: this.rolls,
        history: this.history,
        last: this.last && { ...this.last, decided: this.decided.get(person.id) || [] },
        bets: BETS,
      });
    }
  }
}
