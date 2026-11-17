import { memoryGames, defaults } from './solo-store.js';
import {
  STAKES, SEATS, CASH_OUT_TIMES, newTable, sit, startHand, act, inHand, mustLeave, view, cleanAction, stakesFor, timeoutAction,
} from '../scripts/poker.js';
import { pickBot, decide } from '../scripts/poker-bots.js';

// Trusty Poker on your own: you against 1 to 5 bots, dealt on the site's API (utils/solo-poker.js serves it). No
// database here, so tools/dev-server.mjs and the tests play exactly the same game with games kept in memory.
//
// You sit down by buying in (one bet at the click bank, `solo`, so the bank never gives it back by itself) and play
// chips; getting up pays your stack back as that bet's payout. The bots play inside your request: every move runs
// them until it's your turn again or the hand is over, and the page gets what they did (`log`) to show a move at a
// time. Their cards stay here until they show down. Busted or cashed-out bots are replaced between hands, so the
// table stays the size you picked. You're cashed out after a hand when you're out of chips or up to
// CASH_OUT_TIMES your buy-in (scripts/poker.js: that keeps a payout under the bank's cap).
//
// A sit left alone for STALE_MS is played out (you check or fold) and cashed out on the next visit. Two tabs: every
// save checks the document's version `v`; a buy-in that lost the race goes back.

export const STALE_MS = 60 * 60 * 1000;
export const HERO = 0; // your seat
export const MAX_BOTS = SEATS - 1;
const MOVES = ['sit', 'act', 'next', 'leave'];

const fresh = () => ({ v: 0, table: null, sit: null, pending: null, last: null, at: null });

// What a request's body asks for, or null.
export function cleanMove(body) {
  if (!body || typeof body !== 'object' || !MOVES.includes(body.do)) return null;
  if (body.do === 'sit') {
    const bots = body.bots === undefined ? MAX_BOTS : body.bots;
    return stakesFor(body.buyIn) && Number.isSafeInteger(bots) && bots >= 1 && bots <= MAX_BOTS ? { do: 'sit', buyIn: body.buyIn, bots } : null;
  }
  if (body.do === 'act') {
    const action = cleanAction(body.action);
    return action && { do: 'act', action };
  }
  return { do: body.do };
}

function reply(doc, from, extra = {}) {
  return {
    table: doc.table && view(doc.table, HERO, from),
    sit: doc.sit && { buyIn: doc.sit.buyIn, bots: doc.sit.bots },
    last: doc.last,
    stakes: STAKES,
    cashOutTimes: CASH_OUT_TIMES,
    ...extra,
  };
}

async function save(deps, userId, doc) {
  const ok = await deps.save(userId, { ...doc, v: doc.v + 1 }, doc.v);
  if (ok) doc.v += 1;
  return ok;
}

// The bots play until it's your turn or the hand is over.
function runBots(table, random) {
  for (let guard = 0; inHand(table) && table.hand.toAct !== HERO && guard < 500; guard++) {
    const i = table.hand.toAct;
    if (!act(table, i, decide(table, i, random))) act(table, i, { do: 'fold' });
  }
}

// You're not coming back to this hand: check or fold whenever it's your turn, and let it finish.
function playOut(table, random) {
  for (let guard = 0; inHand(table) && guard < 500; guard++) {
    if (table.hand.toAct === HERO) act(table, HERO, timeoutAction(table, HERO));
    else runBots(table, random);
  }
}

// Between hands: bots who busted or cashed out make way for new ones. Returns why you have to get up, or null.
function between(table, random) {
  let you = null;
  for (const { seat, why } of mustLeave(table)) {
    if (seat === HERO) {
      you = why;
      continue;
    }
    table.seats[seat] = null;
    const bot = pickBot(table, random);
    if (bot) sit(table, seat, bot);
  }
  return you;
}

// Gets you up from the table: your stack is the payout, written down (`pending`) and settled.
function cashOut(doc, why) {
  const stack = doc.table.seats[HERO] ? doc.table.seats[HERO].stack : 0;
  doc.pending = { betId: doc.sit.betId, payout: stack };
  doc.last = { buyIn: doc.sit.buyIn, payout: stack, why, hands: doc.table.hands };
  doc.sit = null;
}

async function settlePending(deps, userId, doc) {
  if (!doc.pending) return null;
  const answer = await deps.bank.settle([{ userId, betId: doc.pending.betId, payout: doc.pending.payout }]);
  doc.pending = null;
  await save(deps, userId, doc); // if another tab beat us to it, the next visit settles again, harmlessly
  return (answer && answer.balances && answer.balances[userId]) || null;
}

// deps: { load(userId), save(userId, doc, v), bank: { stake, settle }, now(), random(), newId() }. move: from
// cleanMove(), or null to just look. Returns what the page gets; `table.hand.log` is what happened during this move.
export async function play(deps, userId, move) {
  let doc = (await deps.load(userId)) || fresh();
  if (doc.sit && deps.now() - doc.at > STALE_MS) {
    playOut(doc.table, deps.random);
    cashOut(doc, 'away');
    if (!(await save(deps, userId, doc))) doc = (await deps.load(userId)) || fresh();
  }
  let bank = await settlePending(deps, userId, doc);
  const table = doc.table;
  const logFrom = table && table.hand ? table.hand.log.length : 0;
  if (!move) return reply(doc, 0, { bank });
  const no = (error) => reply(doc, logFrom, { bank, error });

  let staked = null;
  if (move.do === 'sit') {
    if (doc.sit) return no('You’re already at the table.');
    const betId = deps.newId();
    const answer = await deps.bank.stake({ userId, betId, amount: move.buyIn, game: 'poker', solo: true });
    if (!answer.ok) return no(answer.error);
    staked = { betId, amount: move.buyIn };
    bank = { clicks: answer.clicks, net: answer.net };
    const t = newTable(move.buyIn);
    sit(t, HERO, { id: userId, name: 'You' });
    for (let i = 1; i <= move.bots; i++) sit(t, i, pickBot(t, deps.random));
    t.button = Math.floor(deps.random() * (move.bots + 1)) - 1; // whoever's after it gets the button first
    startHand(t, deps.random);
    runBots(t, deps.random);
    doc.table = t;
    doc.sit = { betId, buyIn: move.buyIn, bots: move.bots };
    doc.last = null;
  } else if (!doc.sit) {
    return no('Buy in first.');
  } else if (move.do === 'act') {
    if (!inHand(table) || table.hand.toAct !== HERO) return no('It’s not your turn.');
    if (!act(table, HERO, move.action)) return no('You can’t do that now.');
    runBots(table, deps.random);
    const me = table.hand.p[HERO];
    if (inHand(table) && (me.folded || me.allIn)) playOut(table, deps.random);
  } else if (move.do === 'next') {
    if (inHand(table)) return no('Finish this hand first.');
    const why = between(table, deps.random);
    if (why) cashOut(doc, why);
    else {
      startHand(table, deps.random);
      runBots(table, deps.random);
    }
  } else { // leave
    if (inHand(table)) {
      if (table.hand.toAct === HERO) act(table, HERO, { do: 'fold' });
      playOut(table, deps.random);
    }
    cashOut(doc, 'left');
  }
  doc.at = deps.now();

  if (!(await save(deps, userId, doc))) {
    // Another tab moved first: give this buy-in back and show the game as it is.
    if (staked) {
      const back = await deps.bank.settle([{ userId, betId: staked.betId, payout: staked.amount }]);
      bank = (back && back.balances && back.balances[userId]) || bank;
    }
    return reply((await deps.load(userId)) || fresh(), 0, { bank, error: 'That table moved on in another tab.' });
  }
  bank = (await settlePending(deps, userId, doc)) || bank;
  return reply(doc, move.do === 'act' ? logFrom : 0, { bank });
}

export { memoryGames, defaults };
