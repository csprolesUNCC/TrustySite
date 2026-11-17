// One Trusty Poker table online: up to six people play No-Limit Hold'em for their site clicks, and bots
// (scripts/poker-bots.js) fill the seats nobody's in. Like realtime/craps-table.js it knows nothing about where it
// runs: realtime/worker.js (one Durable Object per table code) and tools/local-rooms.mjs hand it connections and a
// click bank (realtime/bank.js), and call tick() every tickEvery() ms. The rules are scripts/poker.js; the cards are
// dealt here and nobody sees anyone else's until they show down.
//
// Money: sitting down buys in at the click bank (game `poker`), and getting up pays the stack back as that bet's
// payout. Whoever sits down first at an empty table picks the stakes (STAKES in scripts/poker.js); everyone after
// them buys in for the same. Players win each other's chips as well as the bots', and the house takes the rake.
// You get up (and are paid) after the hand when you ask to, bust, reach CASH_OUT_TIMES your buy-in, time out
// TIMEOUTS_TO_STAND hands in a row, or have sat for TIMES.maxSit (well inside the bank's 2-hour refund of open
// bets, which would otherwise hand back a buy-in whose stack was still at the table). A dropped connection plays
// on (check or fold) until the end of the hand and gets up then, unless it comes back first. When the last person
// leaves, the hand is played out at once and everyone is paid.
//
// Messages from a player: { t: 'sit', buyIn }, { t: 'act', action } (scripts/poker.js cleanAction()), { t: 'leave' }
// (get up after this hand), { t: 'ping' }. To players: { t: 'poker' } after every change (the table from their seat,
// who's here, how long whoever's up has left, when the next hand starts), { t: 'bank', clicks, net } when their
// clicks change, { t: 'notice', message }, { t: 'pong' }, and { t: 'error', message } before the table closes
// their connection.
import {
  POKER_PROTOCOL, SEATS, STAKES, CASH_OUT_TIMES, stakesFor, newTable, sit, startHand, act, inHand, mustLeave, view,
  cleanAction, timeoutAction, seatOf,
} from '../scripts/poker.js';
import { pickBot, decide, thinkTime } from '../scripts/poker-bots.js';
import { CLOSE, send, refuse, flooding, parse, randomId } from './common.js';
import { noBank } from './bank.js';

export const MAX_PEOPLE = 10; // six seats and a few watching
export const TIMEOUTS_TO_STAND = 3;
export const TIMES = {
  turn: 25000,             // to act, then you check or fold
  away: 800,               // how long a player who's gone takes to check or fold
  between: 4500,           // from the end of a hand to the next
  first: 1500,             // from the first person sitting down to the first hand
  idle: 10 * 60 * 1000,    // watching without sitting down for this long, and you're shown the door
  maxSit: 90 * 60 * 1000,  // then you're cashed out after the hand
};
const MAX_MESSAGE = 300;
const fmt = (n) => new Intl.NumberFormat('en-US').format(n);

export function versionProblem(v) {
  return v === String(POKER_PROTOCOL) ? null : 'Trusty Poker was just updated: reload the page to play.';
}

export class PokerTable {
  constructor(code, { bank = noBank, clock = Date.now, random = Math.random, newId = randomId } = {}) {
    Object.assign(this, { code, bank, clock, random, newId });
    this.people = [];       // { conn, id, name, busy, active, second, sent }
    this.table = null;      // scripts/poker.js, once someone has bought in
    this.sits = new Map();  // seat -> { id, name, betId, at, timeouts, asked (wants to get up), gone (disconnected) }
    this.queue = [];        // { id, name, betId, at }: bought in, waiting for the next hand to sit down
    this.due = 0;           // when whoever's up acts by (a bot: when it does; a person: when they're out of time)
    this.nextAt = 0;        // when the next hand starts (0: none planned)
  }

  tickEvery() {
    return this.people.length || this.sits.size || this.queue.length ? 250 : 0;
  }

  join(conn, user, { make = false } = {}) {
    if (make && (this.people.length || this.sits.size)) return refuse(conn, CLOSE.taken, 'That table code is taken.');
    const known = this.people.find((p) => p.id === user.id);
    if (known) {
      const old = known.conn;
      Object.assign(known, { conn, name: user.name });
      old.close(CLOSE.replaced, 'You sat down at this table somewhere else.');
    } else {
      if (this.people.length >= MAX_PEOPLE) return refuse(conn, CLOSE.full, 'That table is full.');
      this.people.push({ conn, id: user.id, name: user.name, busy: false, active: this.clock(), second: 0, sent: 0 });
    }
    // Back before the hand ended: still sitting.
    for (const [seat, s] of this.sits) {
      if (s.id !== user.id) continue;
      s.gone = false;
      if (!s.asked) this.table.seats[seat].leaving = false;
    }
    this.sendAll();
    return true;
  }

  leave(conn) {
    const i = this.people.findIndex((p) => p.conn === conn);
    if (i < 0) return;
    const [gone] = this.people.splice(i, 1);
    for (const [seat, s] of this.sits) {
      if (s.id !== gone.id) continue;
      s.gone = true;
      this.table.seats[seat].leaving = true;
      if (!inHand(this.table) || !this.table.hand.p[seat] || this.table.hand.p[seat].folded) this.cashOut(seat, null);
    }
    this.queue = this.queue.filter((q) => {
      if (q.id === gone.id) this.pay([{ userId: q.id, betId: q.betId, payout: this.table.buyIn }]);
      return q.id !== gone.id;
    });
    if (!this.people.length) this.playOut();
    else {
      this.tidy();
      this.schedule();
    }
    this.sendAll();
  }

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
    else if (msg.t === 'sit') return this.sitDown(person, msg.buyIn);
    else if (msg.t === 'act') this.play(person, msg.action);
    else if (msg.t === 'leave') this.getUp(person);
    return undefined;
  }

  tick() {
    const now = this.clock();
    if (inHand(this.table)) {
      if (this.due && now >= this.due) {
        const i = this.table.hand.toAct;
        const s = this.sits.get(i);
        if (!s) {
          if (!act(this.table, i, decide(this.table, i, this.random))) act(this.table, i, { do: 'fold' });
        } else {
          act(this.table, i, timeoutAction(this.table, i));
          if (!s.gone && !s.asked) {
            s.timeouts += 1;
            if (s.timeouts >= TIMEOUTS_TO_STAND) {
              s.asked = true;
              this.table.seats[i].leaving = true;
              this.tell(s.id, `You ran out of time ${TIMEOUTS_TO_STAND} hands in a row, so you’ll get up after this one.`);
            }
          }
        }
        this.schedule();
        this.sendAll();
      }
    } else if (this.nextAt && now >= this.nextAt) {
      this.between();
      this.sendAll();
    }
    for (const p of [...this.people]) {
      const seated = [...this.sits.values()].some((s) => s.id === p.id) || this.queue.some((q) => q.id === p.id);
      if (seated || p.busy || now - p.active < TIMES.idle) continue;
      this.leave(p.conn);
      refuse(p.conn, CLOSE.idle, 'You left the table after 10 minutes without sitting down.');
    }
  }

  /* ---------- Players ---------- */

  humans() {
    return this.sits.size + this.queue.length;
  }

  async sitDown(person, buyIn) {
    if (person.busy || [...this.sits.values()].some((s) => s.id === person.id) || this.queue.some((q) => q.id === person.id)) return;
    const stakes = stakesFor(buyIn);
    if (!stakes) return;
    const problem = () => {
      if (this.humans() >= SEATS) return 'Every seat is taken by people already.';
      if (this.table && this.humans() && this.table.buyIn !== buyIn) return `This table plays ${fmt(this.table.buyIn)}-click buy-ins.`;
      return null;
    };
    person.active = this.clock();
    if (problem()) return send(person.conn, { t: 'notice', message: problem() });
    const betId = this.newId();
    person.busy = true;
    this.sendAll();
    const answer = await this.bank.stake({ userId: person.id, betId, amount: buyIn, game: 'poker' });
    person.busy = false;
    if (!answer.ok) {
      send(person.conn, { t: 'notice', message: answer.error });
      this.sendAll();
      return;
    }
    send(person.conn, { t: 'bank', clicks: answer.clicks, net: answer.net });
    // Someone else may have sat down with other stakes, or they left, while the bank was busy.
    const late = !this.people.includes(person) ? 'gone' : problem();
    if (late) {
      this.pay([{ userId: person.id, betId, payout: buyIn }]);
      if (late !== 'gone') send(person.conn, { t: 'notice', message: late });
      this.sendAll();
      return;
    }
    if (!this.humans()) this.table = newTable(buyIn);
    this.queue.push({ id: person.id, name: person.name, betId, at: this.clock() });
    if (!inHand(this.table) && !this.nextAt) this.nextAt = this.clock() + TIMES.first;
    this.sendAll();
  }

  play(person, sent) {
    const action = cleanAction(sent);
    const i = this.table ? seatOf(this.table, person.id) : -1;
    if (!action || i < 0 || !inHand(this.table) || this.table.hand.toAct !== i) return;
    person.active = this.clock();
    if (!act(this.table, i, action)) return;
    this.sits.get(i).timeouts = 0;
    this.schedule();
    this.sendAll();
  }

  // Up after this hand (straight away if they're not in it).
  getUp(person) {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => {
      if (q.id === person.id) this.pay([{ userId: q.id, betId: q.betId, payout: this.table.buyIn }]);
      return q.id !== person.id;
    });
    for (const [seat, s] of this.sits) {
      if (s.id !== person.id) continue;
      s.asked = true;
      this.table.seats[seat].leaving = true;
      const h = this.table.hand;
      if (!inHand(this.table) || !h.p[seat] || h.p[seat].folded) this.cashOut(seat, null);
      else this.schedule();
    }
    if (this.queue.length !== before) this.schedule();
    this.tidy();
    this.sendAll();
  }

  /* ---------- The game ---------- */

  // Who's up acts by when.
  schedule() {
    const now = this.clock();
    if (!inHand(this.table)) {
      this.due = 0;
      if (this.table && this.table.hand && !this.nextAt) this.nextAt = now + TIMES.between;
      return;
    }
    const i = this.table.hand.toAct;
    const s = this.sits.get(i);
    this.due = !s ? now + thinkTime(this.random) : s.gone || s.asked ? now + TIMES.away : now + TIMES.turn;
  }

  // Between hands: pay out whoever's getting up, sit the people waiting, fill the rest with bots, deal.
  between() {
    this.nextAt = 0;
    const t = this.table;
    if (!t) return;
    for (const { seat, why } of mustLeave(t)) {
      if (this.sits.has(seat)) this.cashOut(seat, why);
      else t.seats[seat] = null;
    }
    const now = this.clock();
    for (const [seat, s] of this.sits) {
      if (now - s.at >= TIMES.maxSit) this.cashOut(seat, 'time');
    }
    for (const q of this.queue.splice(0)) {
      let seat = t.seats.findIndex((s) => !s);
      if (seat < 0) seat = t.seats.findIndex((s, i) => s && !this.sits.has(i)); // a bot makes way
      t.seats[seat] = null;
      sit(t, seat, { id: q.id, name: q.name });
      this.sits.set(seat, { id: q.id, name: q.name, betId: q.betId, at: q.at, timeouts: 0, asked: false, gone: !this.people.some((p) => p.id === q.id) });
    }
    if (!this.sits.size) {
      this.table = null;
      return;
    }
    for (let i = 0; i < SEATS; i++) {
      if (t.seats[i]) continue;
      const bot = pickBot(t, this.random);
      if (bot) sit(t, i, bot);
    }
    startHand(t, this.random);
    this.schedule();
  }

  // Seat `seat` gets up with their stack, paid at the bank.
  cashOut(seat, why) {
    const s = this.sits.get(seat);
    const stack = this.table.seats[seat] ? this.table.seats[seat].stack : 0;
    this.sits.delete(seat);
    this.table.seats[seat] = null;
    this.pay([{ userId: s.id, betId: s.betId, payout: stack }]);
    const words = {
      bust: 'You’re out of chips. Buy in again to keep playing.',
      cashout: `You’re up to ${CASH_OUT_TIMES} times your buy-in, so Trusty cashed you out with ${fmt(stack)} clicks. Sit back down to keep going!`,
      time: `You’ve been at the table an hour and a half, so you got up with ${fmt(stack)} clicks. Sit back down to keep playing.`,
    };
    this.tell(s.id, words[why] || `You got up with ${fmt(stack)} clicks.`);
  }

  // Nobody sitting, waiting or mid-hand: the table goes (and the next person to sit picks new stakes).
  tidy() {
    if (!this.sits.size && !this.queue.length && !inHand(this.table)) Object.assign(this, { table: null, due: 0, nextAt: 0 });
  }

  // Everyone's gone: play the hand out (bots decide, people check or fold) and pay everyone.
  playOut() {
    for (let guard = 0; inHand(this.table) && guard < 500; guard++) {
      const i = this.table.hand.toAct;
      const move = this.sits.has(i) ? timeoutAction(this.table, i) : decide(this.table, i, this.random);
      if (!act(this.table, i, move)) act(this.table, i, { do: 'fold' });
    }
    for (const seat of [...this.sits.keys()]) this.cashOut(seat, null);
    for (const q of this.queue.splice(0)) this.pay([{ userId: q.id, betId: q.betId, payout: this.table.buyIn }]);
    Object.assign(this, { table: null, due: 0, nextAt: 0 });
  }

  /* ---------- The bank ---------- */

  async pay(bets) {
    if (!bets.length) return;
    const answer = await this.bank.settle(bets);
    for (const p of this.people) {
      const mine = answer && answer.balances && answer.balances[p.id];
      if (mine) send(p.conn, { t: 'bank', ...mine });
    }
  }

  tell(id, message) {
    const p = this.people.find((x) => x.id === id);
    if (p) send(p.conn, { t: 'notice', message });
  }

  /* ---------- What everyone sees ---------- */

  sendAll() {
    const now = this.clock();
    const t = this.table;
    const up = inHand(t) ? t.hand.toAct : -1;
    const people = this.people.map((p) => {
      const seat = t ? seatOf(t, p.id) : -1;
      return { name: p.name, seat, waiting: this.queue.some((q) => q.id === p.id), busy: p.busy };
    });
    for (const person of this.people) {
      const seat = t ? seatOf(t, person.id) : -1;
      const s = this.sits.get(seat);
      send(person.conn, {
        t: 'poker',
        code: this.code,
        you: person.name,
        seat,
        waiting: this.queue.some((q) => q.id === person.id),
        leaving: Boolean(s && s.asked),
        busy: person.busy,
        table: t && view(t, seat),
        people,
        left: up >= 0 && this.sits.has(up) && this.due ? Math.max(0, this.due - now) : 0,
        next: this.nextAt ? Math.max(0, this.nextAt - now) : 0,
        buyIn: t && this.humans() ? t.buyIn : null,
        stakes: STAKES,
        cashOutTimes: CASH_OUT_TIMES,
      });
    }
  }
}
