// One Trusty Blackjack table online: up to five people play against Trusty with their site clicks. Like
// realtime/room.js it knows nothing about where it runs: realtime/worker.js (one Durable Object per table
// code) and tools/local-rooms.mjs hand it connections and a click bank (realtime/bank.js), and call tick()
// every tickEvery() ms. The rules are scripts/blackjack.js, dealt here from a shoe nobody else sees.
//
// Money: every bet (and every double, split and insurance) is staked at the bank before it counts, and every
// hand is settled there when it's over, so the clicks on the table are always really there.
//
// Messages from a player: { t: 'bet', amount } (between hands, for the next one), { t: 'insure', take },
// { t: 'hit' }, { t: 'stand' }, { t: 'double' }, { t: 'split' }, { t: 'ping' }. To players: { t: 'table' } after
// every change (who's sitting here and their bets, the hand as scripts/blackjack.js view()s it, and how long is
// left to act), { t: 'bank', clicks, net } when their clicks change, { t: 'notice', message } when the bank
// says no, { t: 'pong' }, and { t: 'error', message } before the table closes their connection.
import {
  newShoe, deal, insure, insuranceCost, hit, stand, double, split, canDouble, canSplit, raiseCost, dealerStep,
  payouts, view, isBet, BETS, RESHUFFLE_BELOW, TABLE_PROTOCOL,
} from '../scripts/blackjack.js';
import { CLOSE, send, refuse, flooding, parse, randomId } from './common.js';
import { noBank } from './bank.js';

export const MAX_SEATS = 5;
export { BETS };
export const TIMES = {
  betting: 12000,         // once someone has bet, how long everyone else gets
  insurance: 12000,
  turn: 25000,            // for each hand
  dealer: 700,            // between Trusty's cards
  results: 3500,          // before the next hand can start
  idle: 10 * 60 * 1000,   // no bet for this long and you're up from the table
};
const MAX_MESSAGE = 200;

export function versionProblem(v) {
  return v === String(TABLE_PROTOCOL) ? null : 'Trusty Blackjack was just updated: reload the page to play.';
}

export class Table {
  constructor(code, { bank = noBank, clock = Date.now, random = Math.random, newId = randomId } = {}) {
    Object.assign(this, { code, bank, clock, random, newId });
    this.people = [];         // { conn, id, name, bet: { id, amount } | null (for the next hand), busy, active }
    this.names = new Map();   // id -> name, for seats whose player left mid-hand
    this.owners = new Map();  // betId -> account id, until the bet is settled
    this.shoe = newShoe(random);
    this.shuffled = false;
    this.round = null;
    this.phase = 'betting';   // betting | insurance | player | dealer | over
    this.deadline = 0;        // when whoever is up runs out of time (0: nobody's waited on)
    this.stage = '';
    this.hands = 0;
  }

  tickEvery() {
    return this.people.length ? 100 : 0;
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
      if (this.people.length >= MAX_SEATS) return refuse(conn, CLOSE.full, 'That table is full: five players already.');
      this.people.push({ conn, id: user.id, name: user.name, bet: null, busy: false, active: this.clock(), second: 0, sent: 0 });
    }
    this.names.set(user.id, user.name);
    this.sendAll();
    return true;
  }

  leave(conn) {
    const i = this.people.findIndex((p) => p.conn === conn);
    if (i < 0) return;
    const [gone] = this.people.splice(i, 1);
    if (gone.bet) this.refund(gone.id, gone.bet);
    const dealing = this.phase !== 'betting' && this.phase !== 'over';
    if (!this.people.length) this.playOut();
    else if (dealing) this.advance(); // they can't hold the hand up
    if (this.phase === 'betting') {
      if (!this.people.some((p) => p.bet)) this.deadline = 0;
      else if (this.people.every((p) => p.bet && !p.busy)) this.startHand();
    }
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
    else if (msg.t === 'bet') return this.bet(person, msg.amount);
    else if (msg.t === 'insure') return this.insure(person, msg.take === true);
    else if (msg.t === 'double' || msg.t === 'split') return this.raise(person, msg.t);
    else if (msg.t === 'hit' || msg.t === 'stand') this.play(person, msg.t);
    return undefined;
  }

  tick() {
    const now = this.clock();
    if (this.deadline && now >= this.deadline) this.timeUp(now);
    if (this.phase === 'betting' || this.phase === 'over') {
      for (const p of [...this.people]) {
        if (p.bet || p.busy || now - p.active < TIMES.idle) continue;
        this.leave(p.conn);
        refuse(p.conn, CLOSE.idle, 'You got up from the table after 10 minutes without a bet.');
      }
    }
  }

  /* ---------- Players ---------- */

  async bet(person, amount) {
    if (!(this.phase === 'betting' || this.phase === 'over') || person.bet || person.busy) return;
    if (!isBet(amount)) return;
    const stake = { id: this.newId(), amount };
    if (!(await this.charge(person, stake))) return;
    if (!this.people.includes(person)) {
      this.refund(person.id, stake); // got up while the bank was busy
      return;
    }
    person.bet = stake;
    person.active = this.clock();
    if (this.phase === 'betting') {
      if (this.people.every((p) => p.bet && !p.busy)) this.startHand(); // everyone's in: no need to wait
      else if (!this.deadline) this.deadline = this.clock() + TIMES.betting;
    }
    this.sendAll();
  }

  async insure(person, take) {
    const r = this.round;
    const i = r && r.phase === 'insurance' ? r.seats.findIndex((s) => s.id === person.id) : -1;
    if (i < 0 || r.seats[i].decided || person.busy) return;
    if (!take) {
      insure(r, i, null);
      this.advance();
      this.sendAll();
      return;
    }
    const stake = { id: this.newId(), amount: insuranceCost(r, i) };
    if (!(await this.charge(person, stake))) return;
    if (this.round === r && r.phase === 'insurance' && !r.seats[i].decided) {
      insure(r, i, stake);
      this.advance();
    } else {
      this.refund(person.id, stake);
    }
    this.sendAll();
  }

  play(person, action) {
    const r = this.round;
    if (!r || r.phase !== 'player' || r.seats[r.turn].id !== person.id || person.busy) return;
    if (action === 'hit') hit(r);
    else stand(r);
    this.advance();
    this.sendAll();
  }

  // Double or split: the same again, staked first.
  async raise(person, action) {
    const r = this.round;
    if (!r || r.phase !== 'player' || r.seats[r.turn].id !== person.id || person.busy) return;
    if (action === 'double' ? !canDouble(r) : !canSplit(r)) return;
    const spot = `${r.turn}:${r.active}:${r.seats[r.turn].hands.length}`;
    const stake = { id: this.newId(), amount: raiseCost(r) };
    if (!(await this.charge(person, stake))) return;
    const same = this.round === r && r.phase === 'player' && `${r.turn}:${r.active}:${r.seats[r.turn].hands.length}` === spot;
    if (same && (action === 'double' ? double(r, stake) : split(r, stake))) this.advance();
    else this.refund(person.id, stake);
    this.sendAll();
  }

  /* ---------- The hand ---------- */

  startHand() {
    const players = this.people.filter((p) => p.bet && !p.busy);
    if (!players.length) return;
    this.shuffled = this.shoe.length < RESHUFFLE_BELOW;
    if (this.shuffled) this.shoe = newShoe(this.random);
    this.hands += 1;
    this.round = deal(this.shoe, players.map((p) => ({ id: p.id, stake: p.bet })));
    for (const p of players) p.bet = null;
    this.stage = '';
    this.advance();
  }

  // After anything happens in a hand: decide for whoever got up, give whoever is up their time, and settle
  // the hand once it's over.
  advance() {
    const r = this.round;
    const here = (id) => this.people.some((p) => p.id === id);
    if (r.phase === 'insurance') r.seats.forEach((s, i) => { if (!s.decided && !here(s.id)) insure(r, i, null); });
    while (r.phase === 'player' && !here(r.seats[r.turn].id)) stand(r);
    this.phase = r.phase;
    if (r.phase === 'over') {
      this.finishHand();
      return;
    }
    const stage = `${this.hands}:${r.phase}:${r.turn}:${r.active}`;
    if (stage === this.stage) return;
    this.stage = stage;
    this.deadline = this.clock() + (r.phase === 'insurance' ? TIMES.insurance : r.phase === 'player' ? TIMES.turn : TIMES.dealer);
  }

  timeUp(now) {
    const r = this.round;
    this.deadline = 0;
    if (this.phase === 'betting') {
      this.startHand();
    } else if (this.phase === 'over') {
      this.phase = 'betting';
      if (this.people.some((p) => p.bet)) {
        if (this.people.every((p) => p.bet && !p.busy)) this.startHand();
        else this.deadline = now + TIMES.betting;
      }
    } else if (this.phase === 'insurance' || this.phase === 'player') {
      // Out of time: no insurance, or stand. Someone waiting on the bank gets a moment longer.
      const waiting = (id) => this.people.some((p) => p.id === id && p.busy);
      if (this.phase === 'insurance') {
        r.seats.forEach((s, i) => { if (!s.decided && !waiting(s.id)) insure(r, i, null); });
        if (r.phase === 'insurance') this.deadline = now + 1000;
      } else if (waiting(r.seats[r.turn].id)) {
        this.deadline = now + 1000;
      } else {
        stand(r);
      }
      if (!this.deadline) this.advance();
    } else if (this.phase === 'dealer') {
      if (dealerStep(r)) this.deadline = now + TIMES.dealer;
      else this.advance();
    }
    this.sendAll();
  }

  finishHand() {
    const bets = payouts(this.round).map(({ id, payout }) => ({ userId: this.owners.get(id), betId: id, payout }));
    for (const b of bets) this.owners.delete(b.betId);
    this.phase = 'over';
    this.stage = '';
    this.deadline = this.clock() + TIMES.results;
    this.pay(bets.filter((b) => b.userId));
  }

  // Nobody's left to watch: play the hand out at once (stand everything), so the bets still get settled, and
  // wait for the next player.
  playOut() {
    const r = this.round;
    if (r && this.phase !== 'over' && this.phase !== 'betting') {
      r.seats.forEach((s, i) => { if (r.phase === 'insurance' && !s.decided) insure(r, i, null); });
      while (r.phase === 'player') stand(r);
      while (dealerStep(r));
      this.finishHand();
    }
    this.phase = 'betting';
    this.deadline = 0;
  }

  /* ---------- The bank ---------- */

  // Stakes a bet for `person` (they're busy meanwhile). False if the bank said no, and tells them why.
  async charge(person, stake) {
    person.busy = true;
    this.sendAll();
    const answer = await this.bank.stake({ userId: person.id, betId: stake.id, amount: stake.amount, game: 'blackjack' });
    person.busy = false;
    if (!answer.ok) {
      send(person.conn, { t: 'notice', message: answer.error });
      this.sendAll();
      return false;
    }
    this.owners.set(stake.id, person.id);
    send(person.conn, { t: 'bank', clicks: answer.clicks, net: answer.net });
    return true;
  }

  refund(userId, stake) {
    this.owners.delete(stake.id);
    this.pay([{ userId, betId: stake.id, payout: stake.amount }]);
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
    const shown = this.round && view(this.round);
    for (const person of this.people) {
      send(person.conn, {
        t: 'table',
        code: this.code,
        you: person.name,
        phase: this.phase,
        hand: this.hands,
        shuffled: this.shuffled,
        left: this.deadline ? Math.max(0, this.deadline - now) : 0,
        people: this.people.map((p) => ({ name: p.name, bet: p.bet ? p.bet.amount : 0, busy: p.busy })),
        round: shown && {
          ...shown,
          seats: shown.seats.map(({ id, ...seat }) => ({ ...seat, name: this.names.get(id), you: id === person.id })),
        },
        bets: BETS,
      });
    }
  }
}
