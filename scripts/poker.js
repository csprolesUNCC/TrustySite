// Trusty Poker's rules: No-Limit Texas Hold'em at a six-seat table, with no drawing or timing code. The solo game
// (utils/solo-poker-game.js, you against the bots on the site's API) and the online tables (realtime/poker-table.js)
// both deal with these, and the tests rig the cards. A table is plain data that the functions below change.
//
// Money: everyone at a table buys in for the same amount (STAKES, which also set the blinds), and plays chips; the
// click bank holds the buy-in as one bet and pays the stack back when they get up. The house takes a rake: RAKE.rate
// of every pot that sees a flop (no flop, no drop), at most RAKE.capBB big blinds. A seat whose stack reaches
// CASH_OUT_TIMES its buy-in is cashed out after the hand (mustLeave()), so at the start of a hand every stack is
// under that, and nobody can leave with more than SEATS times it: MAX_RETURN, the most the bank will pay back on
// a buy-in (MAX_RETURN in utils/bank-rules.js).
//
// Cards are two-letter strings: rank (23456789TJQKA) then suit (s h d c), like 'Ah' or 'Tc'.

export const POKER_PROTOCOL = 1; // bump whenever a table message (realtime/poker-table.js) changes shape
export const SEATS = 6;
export const STAKES = [
  { buyIn: 100, sb: 1, bb: 2 },
  { buyIn: 200, sb: 2, bb: 4 },
  { buyIn: 500, sb: 5, bb: 10 },
];
export const stakesFor = (buyIn) => STAKES.find((s) => s.buyIn === buyIn) || null;
export const CASH_OUT_TIMES = 5;
export const RAKE = { rate: 0.05, capBB: 3 };
export const MAX_RETURN = SEATS * CASH_OUT_TIMES;
export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const STREETS = ['preflop', 'flop', 'turn', 'river'];

export const isCard = (c) => typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1]);

export function newDeck(random = Math.random) {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/* ---------- Hand strength ---------- */

// A card as a number: rank 0-12 (2 to Ace) times 4, plus the suit 0-3. The bots' simulations work in these.
export const cardInt = (c) => RANKS.indexOf(c[0]) * 4 + SUITS.indexOf(c[1]);

const RC = new Uint8Array(13);
const SM = new Uint16Array(4);
const SC = new Uint8Array(4);

// The top card of the best straight in a 13-bit rank mask (bit r = rank r), or -1. The Ace also plays low.
function straightTop(mask) {
  const m = (mask << 1) | ((mask >> 12) & 1); // bit 0: Ace low, bits 1-13: 2 to Ace
  for (let top = 13; top >= 4; top--) if (((m >> (top - 4)) & 31) === 31) return top - 1;
  return -1;
}

// The best `k` ranks present, highest first, skipping ranks in `skip` (a mask), packed 4 bits each.
function kickers(skip, k) {
  let out = 0;
  let n = 0;
  for (let r = 12; r >= 0 && n < k; r--) {
    if (RC[r] && !((skip >> r) & 1)) {
      out = (out << 4) | r;
      n++;
    }
  }
  return out << (4 * (k - n));
}

// The strength of the best five of these cards (ints, 5 to 7 of them): a bigger number is a better hand. The
// category (0 high card ... 8 straight flush) is in bits 20-23, the ranks that break ties under it.
export function scoreInts(cards, n = cards.length) {
  RC.fill(0);
  SM.fill(0);
  SC.fill(0);
  let mask = 0;
  for (let i = 0; i < n; i++) {
    const r = cards[i] >> 2;
    const s = cards[i] & 3;
    RC[r]++;
    SM[s] |= 1 << r;
    SC[s]++;
    mask |= 1 << r;
  }
  let flush = 0;
  for (let s = 0; s < 4; s++) {
    if (SC[s] < 5) continue;
    const top = straightTop(SM[s]);
    if (top >= 0) return (8 << 20) | (top << 16);
    flush = SM[s];
  }
  let quad = -1;
  let trip = -1;
  let trip2 = -1;
  let pair = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const c = RC[r];
    if (c === 4) quad = r;
    else if (c === 3) {
      if (trip < 0) trip = r;
      else if (trip2 < 0) trip2 = r;
    } else if (c === 2) {
      if (pair < 0) pair = r;
      else if (pair2 < 0) pair2 = r;
    }
  }
  if (quad >= 0) return (7 << 20) | (quad << 16) | (kickers(1 << quad, 1) << 12);
  if (trip >= 0 && (trip2 >= 0 || pair >= 0)) return (6 << 20) | (trip << 16) | (Math.max(trip2, pair) << 12);
  if (flush) {
    let out = 0;
    let k = 0;
    for (let r = 12; r >= 0 && k < 5; r--) {
      if ((flush >> r) & 1) {
        out = (out << 4) | r;
        k++;
      }
    }
    return (5 << 20) | out;
  }
  const straight = straightTop(mask);
  if (straight >= 0) return (4 << 20) | (straight << 16);
  if (trip >= 0) return (3 << 20) | (trip << 16) | (kickers(1 << trip, 2) << 8);
  if (pair2 >= 0) return (2 << 20) | (pair << 16) | (pair2 << 12) | (kickers((1 << pair) | (1 << pair2), 1) << 8);
  if (pair >= 0) return (1 << 20) | (pair << 16) | (kickers(1 << pair, 3) << 4);
  return kickers(0, 5);
}

export const evaluate = (cards) => scoreInts(cards.map(cardInt));

const ONE = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const MANY = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
export const CATEGORIES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

// A score in words: "Pair of Kings", "Full house, Tens full of Fours".
export function describeScore(score) {
  const cat = score >> 20;
  const a = (score >> 16) & 15;
  const b = (score >> 12) & 15;
  switch (cat) {
    case 8: return a === 12 ? 'Royal flush' : `${ONE[a]}-high straight flush`;
    case 7: return `Four ${MANY[a]}`;
    case 6: return `Full house, ${MANY[a]} full of ${MANY[b]}`;
    case 5: return `${ONE[a]}-high flush`;
    case 4: return `${ONE[a]}-high straight`;
    case 3: return `Three ${MANY[a]}`;
    case 2: return `Two pair, ${MANY[a]} and ${MANY[b]}`;
    case 1: return `Pair of ${MANY[a]}`;
    default: return `${ONE[a]} high`;
  }
}

// The five cards that make the best hand, for showing which ones count.
export function bestFive(cards) {
  const ints = cards.map(cardInt);
  let best = -1;
  let pick = cards.slice(0, 5);
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
    const s = scoreInts([ints[a], ints[b], ints[c], ints[d], ints[e]]);
    if (s > best) {
      best = s;
      pick = [cards[a], cards[b], cards[c], cards[d], cards[e]];
    }
  }
  return pick;
}

/* ---------- The table ---------- */

// seats: SEATS places, each null or { id, name, bot (a style from scripts/poker-bots.js, or null for a person),
// stack, leaving (gets up after this hand) }.
export function newTable(buyIn) {
  const s = stakesFor(buyIn);
  if (!s) return null;
  return { buyIn, sb: s.sb, bb: s.bb, seats: Array(SEATS).fill(null), button: -1, hand: null, hands: 0, dealt: 0 };
}

export function sit(table, i, { id, name, bot = null }) {
  if (table.seats[i]) return false;
  table.seats[i] = { id, name, bot, stack: table.buyIn, leaving: false };
  return true;
}

export const freeSeats = (table) => table.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
export const seatOf = (table, id) => table.seats.findIndex((s) => s && s.id === id);
export const inHand = (table) => Boolean(table && table.hand) && table.hand.street !== 'over';

// The next seat after `from` (going round to the left) where `ok(i)` holds, or -1.
function next(from, ok) {
  for (let k = 1; k <= SEATS; k++) {
    const i = (((from + k) % SEATS) + SEATS) % SEATS;
    if (ok(i)) return i;
  }
  return -1;
}

const contenders = (h) => h.p.map((p, i) => (p && !p.folded ? i : -1)).filter((i) => i >= 0);
const needsAction = (h, i) => {
  const p = h.p[i];
  return Boolean(p) && !p.folded && !p.allIn && (!p.acted || p.bet < h.currentBet);
};
export const potOf = (h) => h.p.reduce((sum, p) => sum + (p ? p.total : 0), 0);

// Who can be dealt in: a stack and not on their way out.
const dealable = (table, i) => Boolean(table.seats[i]) && table.seats[i].stack > 0 && !table.seats[i].leaving;

// Deals the next hand: moves the button, posts the blinds, two cards each. Returns false with fewer than two
// players.
export function startHand(table, random = Math.random) {
  const players = table.seats.map((_, i) => i).filter((i) => dealable(table, i));
  if (players.length < 2) return false;
  table.button = next(table.button, (i) => dealable(table, i));
  const heads = players.length === 2;
  const sbSeat = heads ? table.button : next(table.button, (i) => dealable(table, i));
  const bbSeat = next(sbSeat, (i) => dealable(table, i));
  const h = {
    deck: newDeck(random),
    board: [],
    street: 'preflop',
    p: table.seats.map((_, i) => (dealable(table, i) ? { cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, mayRaise: true } : null)),
    sbSeat,
    bbSeat,
    toAct: -1,
    currentBet: table.bb,
    minRaise: table.bb,
    flopSeen: false,
    log: [],
    result: null,
  };
  table.hand = h;
  table.dealt = (table.dealt || 0) + 1;
  post(table, sbSeat, table.sb, 'sb');
  post(table, bbSeat, table.bb, 'bb');
  for (let round = 0; round < 2; round++) {
    let i = sbSeat;
    do {
      h.p[i].cards.push(h.deck.pop());
      i = next(i, (j) => Boolean(h.p[j]));
    } while (i !== sbSeat);
  }
  h.toAct = heads ? sbSeat : next(bbSeat, (i) => Boolean(h.p[i]));
  if (!needsAction(h, h.toAct)) advance(table, h.toAct);
  return true;
}

function pay(table, i, amount) {
  const p = table.hand.p[i];
  const seat = table.seats[i];
  const paid = Math.min(amount, seat.stack);
  seat.stack -= paid;
  p.bet += paid;
  p.total += paid;
  if (seat.stack === 0) p.allIn = true;
  return paid;
}

function post(table, i, amount, what) {
  const paid = pay(table, i, amount);
  table.hand.log.push({ seat: i, do: what, amount: paid, street: 'preflop' });
}

// What the seat that's up may do: { check, call (what calling costs, 0 when checking), raise: { min, max } (the
// totals they may raise to this street; max is all in) or null, bet (true when nobody has bet this street yet) }.
export function legal(table, i) {
  const h = table.hand;
  if (!h || h.street === 'over' || h.toAct !== i || !h.p[i]) return null;
  const p = h.p[i];
  const stack = table.seats[i].stack;
  const owe = h.currentBet - p.bet;
  const call = Math.min(owe, stack);
  const othersCanAct = contenders(h).some((j) => j !== i && !h.p[j].allIn);
  const canRaise = p.mayRaise && othersCanAct && stack > owe;
  const maxTo = p.bet + stack;
  return {
    check: owe <= 0,
    call: owe > 0 ? call : 0,
    raise: canRaise ? { min: Math.min(h.currentBet + h.minRaise, maxTo), max: maxTo } : null,
    bet: h.currentBet === 0,
  };
}

// An action from a page or a bot, or null: { do: 'fold' | 'check' | 'call' } or { do: 'raise', to }.
export function cleanAction(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.do === 'fold' || a.do === 'check' || a.do === 'call') return { do: a.do };
  if (a.do === 'raise' && Number.isSafeInteger(a.to) && a.to > 0) return { do: 'raise', to: a.to };
  return null;
}

// What happens when someone runs out of time: check if they can, fold if they can't.
export const timeoutAction = (table, i) => (legal(table, i) && legal(table, i).check ? { do: 'check' } : { do: 'fold' });

// Seat `i` does `action`. False (and nothing changes) if it isn't their turn or the action isn't allowed.
export function act(table, i, action) {
  const h = table.hand;
  const can = legal(table, i);
  const a = cleanAction(action);
  if (!can || !a) return false;
  const p = h.p[i];
  const street = h.street;
  if (a.do === 'fold') {
    p.folded = true;
    h.log.push({ seat: i, do: 'fold', street });
  } else if (a.do === 'check') {
    if (!can.check) return false;
    h.log.push({ seat: i, do: 'check', street });
  } else if (a.do === 'call') {
    if (can.check) return false;
    const paid = pay(table, i, can.call);
    h.log.push({ seat: i, do: 'call', amount: paid, allIn: p.allIn, street });
  } else {
    if (!can.raise || a.to < can.raise.min || a.to > can.raise.max) return false;
    const was = h.currentBet;
    pay(table, i, a.to - p.bet);
    const size = a.to - was;
    if (size >= h.minRaise) {
      h.minRaise = size;
      for (const q of h.p) if (q && q !== p) q.mayRaise = true;
    }
    h.currentBet = a.to;
    for (const q of h.p) if (q && q !== p && !q.folded && !q.allIn) q.acted = false;
    h.log.push({ seat: i, do: was === 0 ? 'bet' : 'raise', amount: a.to, allIn: p.allIn, street });
  }
  p.acted = true;
  p.mayRaise = false;
  advance(table, i);
  return true;
}

// On to whoever's next after seat `from`: the next player who still has to act, the next street, or the end.
function advance(table, from) {
  const h = table.hand;
  if (contenders(h).length === 1) return finish(table);
  const up = next(from, (i) => needsAction(h, i));
  if (up >= 0) {
    h.toAct = up;
    return undefined;
  }
  return endStreet(table);
}

function endStreet(table) {
  const h = table.hand;
  for (const p of h.p) {
    if (!p) continue;
    p.bet = 0;
    p.acted = false;
    p.mayRaise = true;
  }
  h.currentBet = 0;
  h.minRaise = table.bb;
  const able = contenders(h).filter((i) => !h.p[i].allIn);
  if (h.street === 'river') return finish(table);
  // Nobody left who can bet: deal the rest and show down.
  if (able.length <= 1) {
    while (h.board.length < 5) dealStreet(h);
    return finish(table);
  }
  dealStreet(h);
  h.toAct = next(table.button, (i) => needsAction(h, i));
  return undefined;
}

function dealStreet(h) {
  h.deck.pop(); // burn one
  const street = STREETS[STREETS.indexOf(h.street) + 1];
  const cards = street === 'flop' ? [h.deck.pop(), h.deck.pop(), h.deck.pop()] : [h.deck.pop()];
  h.board.push(...cards);
  h.street = street;
  if (street === 'flop') h.flopSeen = true;
  h.log.push({ deal: street, cards });
}

// The pots, from what everyone put in: [{ amount, eligible: [seats] }], main pot first, plus any bet nobody called
// (`returned`: { seat, amount }), which goes straight back.
export function potsOf(h) {
  const totals = h.p.map((p, i) => (p ? { i, total: p.total, folded: p.folded } : null)).filter(Boolean);
  const sorted = [...totals].sort((a, b) => b.total - a.total);
  let returned = null;
  const counted = new Map(totals.map((t) => [t.i, t.total]));
  if (sorted.length && sorted[0].total > (sorted[1] ? sorted[1].total : 0)) {
    const amount = sorted[0].total - (sorted[1] ? sorted[1].total : 0);
    returned = { seat: sorted[0].i, amount };
    counted.set(sorted[0].i, sorted[0].total - amount);
  }
  const live = totals.filter((t) => !t.folded);
  const levels = [...new Set(live.map((t) => counted.get(t.i)))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const t of totals) amount += Math.max(0, Math.min(counted.get(t.i), level) - prev);
    const eligible = live.filter((t) => counted.get(t.i) >= level).map((t) => t.i);
    if (amount > 0) {
      const last = pots.at(-1);
      if (last && last.eligible.length === eligible.length) last.amount += amount; // same players: one pot
      else pots.push({ amount, eligible });
    }
    prev = level;
  }
  // Chips folded players put in above the last level (they bet, then folded to a raise) go in the last pot.
  const over = totals.reduce((sum, t) => sum + Math.max(0, counted.get(t.i) - prev), 0);
  if (over && pots.length) pots.at(-1).amount += over;
  return { pots, returned };
}

export const rakeFor = (table, amount) => Math.min(Math.floor(amount * RAKE.rate), RAKE.capBB * table.bb);

// Pays out the hand: the uncalled bet back, the rake off the top (if it saw a flop), then each pot to its best
// hand. Ties split, odd chips go to the first winner left of the button.
function finish(table) {
  const h = table.hand;
  const { pots, returned } = potsOf(h);
  const won = {};
  const add = (i, n) => { won[i] = (won[i] || 0) + n; };
  if (returned) table.seats[returned.seat].stack += returned.amount;
  const total = pots.reduce((sum, p) => sum + p.amount, 0);
  let rake = h.flopSeen ? rakeFor(table, total) : 0;
  const raked = rake;
  for (const pot of pots) {
    const take = Math.min(rake, pot.amount);
    pot.amount -= take;
    rake -= take;
  }
  const live = contenders(h);
  const showdown = live.length > 1;
  const scores = {};
  const shown = {};
  if (showdown) {
    for (const i of live) {
      const cards = [...h.p[i].cards, ...h.board];
      scores[i] = evaluate(cards);
      shown[i] = { cards: h.p[i].cards.slice(), name: describeScore(scores[i]), best: bestFive(cards) };
    }
  }
  const out = [];
  for (const pot of pots) {
    let winners = pot.eligible;
    if (showdown && winners.length > 1) {
      const best = Math.max(...winners.map((i) => scores[i]));
      winners = winners.filter((i) => scores[i] === best);
    }
    // Left of the button first, for the odd chips.
    winners = [...winners].sort((a, b) => ((a - table.button - 1 + SEATS) % SEATS) - ((b - table.button - 1 + SEATS) % SEATS));
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const i of winners) {
      const n = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      table.seats[i].stack += n;
      add(i, n);
    }
    out.push({ amount: pot.amount, winners, name: showdown ? shown[winners[0]].name : null });
  }
  h.street = 'over';
  h.toAct = -1;
  h.result = { pots: out, rake: raked, returned, won, shown: showdown ? shown : {} };
  table.hands += 1;
  return undefined;
}

/* ---------- Between hands ---------- */

// Who has to get up now the hand is over: out of chips, or up to CASH_OUT_TIMES the buy-in (which keeps every
// payout under MAX_RETURN), or on their way out. [{ seat, why: 'bust' | 'cashout' | 'leaving' }]
export function mustLeave(table) {
  const out = [];
  table.seats.forEach((s, i) => {
    if (!s) return;
    if (s.stack <= 0) out.push({ seat: i, why: 'bust' });
    else if (s.stack >= CASH_OUT_TIMES * table.buyIn) out.push({ seat: i, why: 'cashout' });
    else if (s.leaving) out.push({ seat: i, why: 'leaving' });
  });
  return out;
}

/* ---------- What a player may see ---------- */

// The table as seat `viewer` (or -1 for someone watching) may see it: their own cards, and everyone's who showed
// down, never the deck. `log` is only what happened after entry `from`.
export function view(table, viewer = -1, from = 0) {
  const h = table.hand;
  const shown = (h && h.result && h.result.shown) || {};
  return {
    buyIn: table.buyIn,
    sb: table.sb,
    bb: table.bb,
    button: table.button,
    hands: table.hands,
    dealt: table.dealt || 0,
    you: viewer,
    seats: table.seats.map((s) => (s ? { name: s.name, bot: Boolean(s.bot), stack: s.stack, leaving: Boolean(s.leaving) } : null)),
    hand: h && {
      street: h.street,
      board: h.board.slice(),
      toAct: h.toAct,
      currentBet: h.currentBet,
      pot: potOf(h),
      sbSeat: h.sbSeat,
      bbSeat: h.bbSeat,
      players: h.p.map((p, i) => p && {
        bet: p.bet,
        total: p.total,
        folded: p.folded,
        allIn: p.allIn,
        cards: i === viewer || shown[i] ? p.cards.slice() : null,
      }),
      result: h.result,
      legal: viewer >= 0 ? legal(table, viewer) : null,
      log: h.log.slice(from),
      logAt: from,
    },
  };
}
