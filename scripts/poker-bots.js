// Trusty Poker's computer players. Pure JS, no DOM, so the site's API (utils/solo-poker-game.js), the online tables
// (realtime/poker-table.js) and the tests all run the same bots.
//
// How one decides: before the flop it goes by a starting-hand score (the Chen formula), against thresholds set by
// its style and by how much it has to put in. After the flop it estimates its chance of winning by dealing the
// rest of the hand out at random a few hundred times (against as many random hands as there are opponents left),
// trims that when someone has bet into it (people bet good hands), and compares it with the pot odds. Raises are
// sized from the pot, and a little randomness (plus the odd bluff) keeps it from being an open book. They are
// decent against casual play but nowhere near a solver: a good player can beat them, and the rake is what keeps
// the house's side of the table about even.
import { RANKS, cardInt, scoreInts, legal, potOf } from './poker.js';

// tight: how good a hand has to be to play; aggro: how often it bets and raises a good one; bluff: how often it
// bets with nothing when checked to; sticky: how much worse than the pot odds it still calls.
export const STYLES = {
  rock: { tight: 2, aggro: 0.45, bluff: 0.03, sticky: -0.04 },
  shark: { tight: 0, aggro: 0.75, bluff: 0.1, sticky: 0 },
  maniac: { tight: -1.5, aggro: 0.85, bluff: 0.16, sticky: 0 },
  station: { tight: -0.5, aggro: 0.35, bluff: 0.03, sticky: 0.04 },
};

// Who sits in the empty seats, with their style. Trusty plays too, as a shark.
export const ROSTER = [
  { name: 'Trusty', style: 'shark' },
  { name: 'Clover', style: 'rock' },
  { name: 'Buckshot', style: 'maniac' },
  { name: 'Old Gus', style: 'station' },
  { name: 'Daisy', style: 'shark' },
  { name: 'Pickles', style: 'maniac' },
  { name: 'Juniper', style: 'rock' },
  { name: 'Biscuit', style: 'station' },
  { name: 'Maverick', style: 'shark' },
];

// A bot for an empty seat: the first on the roster (from a random start) not already at the table.
export function pickBot(table, random = Math.random) {
  const taken = new Set(table.seats.filter(Boolean).map((s) => s.name.toLowerCase()));
  const start = Math.floor(random() * ROSTER.length);
  for (let k = 0; k < ROSTER.length; k++) {
    const b = ROSTER[(start + k) % ROSTER.length];
    if (!taken.has(b.name.toLowerCase())) return { id: `bot:${b.name}`, name: b.name, bot: b.style };
  }
  return null;
}

// The Chen formula: how good two starting cards are, from about -1 (7-2) to 20 (Aces).
export function chen(cards) {
  const [a, b] = cards.map((c) => RANKS.indexOf(c[0])).sort((x, y) => y - x);
  const points = (r) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  if (a === b) return Math.max(5, points(a) * 2);
  let score = points(a);
  if (cards[0][1] === cards[1][1]) score += 2;
  const gap = a - b - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && a < 10) score += 1;
  return Math.ceil(score);
}

// The chance these hole cards win at showdown against `opponents` random hands, with `board` so far, from
// `runs` random deals of the rest (ties count as shared).
export function equity(cards, board, opponents, random = Math.random, runs = 200) {
  const mine = cards.map(cardInt);
  const known = board.map(cardInt);
  const used = new Set([...mine, ...known]);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const need = 5 - known.length;
  const hand = new Array(7);
  const theirs = new Array(7);
  let total = 0;
  for (let run = 0; run < runs; run++) {
    // Draw what's needed off the top of a partly shuffled deck.
    const draw = need + opponents * 2;
    for (let k = 0; k < draw; k++) {
      const j = k + Math.floor(random() * (deck.length - k));
      const t = deck[k];
      deck[k] = deck[j];
      deck[j] = t;
    }
    let n = 0;
    for (const c of known) { hand[n] = c; theirs[n] = c; n++; }
    for (let k = 0; k < need; k++) { hand[n] = deck[k]; theirs[n] = deck[k]; n++; }
    hand[5] = mine[0];
    hand[6] = mine[1];
    const me = scoreInts(hand, 7);
    let ties = 0;
    let lost = false;
    for (let o = 0; o < opponents && !lost; o++) {
      theirs[5] = deck[need + o * 2];
      theirs[6] = deck[need + o * 2 + 1];
      const s = scoreInts(theirs, 7);
      if (s > me) lost = true;
      else if (s === me) ties++;
    }
    if (!lost) total += 1 / (ties + 1);
  }
  return total / runs;
}

const roundTo = (n, step) => Math.max(step, Math.round(n / step) * step);

// A raise to about `fraction` of the pot on top of calling, kept inside what's allowed (and all in once it's most
// of the stack anyway).
function raiseTo(table, i, can, fraction) {
  const h = table.hand;
  const owe = can.call;
  const pot = potOf(h) + owe;
  let to = h.currentBet + roundTo(pot * fraction, table.sb);
  to = Math.max(can.raise.min, Math.min(can.raise.max, to));
  if (to > can.raise.max * 0.7) to = can.raise.max;
  return { do: 'raise', to };
}

// What the bot in seat `i` does now. Always something legal.
export function decide(table, i, random = Math.random) {
  const h = table.hand;
  const can = legal(table, i);
  if (!can) return null;
  const style = STYLES[table.seats[i].bot] || STYLES.shark;
  const me = h.p[i];
  const opponents = h.p.filter((p, j) => p && j !== i && !p.folded).length;
  const pot = potOf(h);
  const owe = can.call;
  const stack = table.seats[i].stack;
  const odds = owe > 0 ? owe / (pot + owe) : 0;
  const passive = can.check ? { do: 'check' } : { do: 'fold' };
  const roll = random();

  if (h.street === 'preflop') {
    const score = chen(me.cards) - style.tight - Math.max(0, opponents - 3) * 0.5;
    const facing = (h.currentBet - table.bb) / table.bb; // big blinds raised over the blind
    const shove = owe >= stack * 0.5;
    if (shove) {
      if (score >= 12 || (score >= 10 && odds < 0.4)) return can.raise ? { do: 'raise', to: can.raise.max } : { do: 'call' };
      return score >= 9 + (odds > 0.35 ? 0 : -1) - style.sticky * 10 && roll < 0.5 ? { do: 'call' } : passive;
    }
    if (facing <= 0) {
      // Nobody has raised: open, limp or let it go.
      if (score >= 8 && can.raise && roll < 0.55 + style.aggro * 0.4) return raiseTo(table, i, can, 0.75);
      if (score >= 5 + (owe > 0 ? 1 : 0)) return owe > 0 ? { do: 'call' } : { do: 'check' };
      if (can.check) return { do: 'check' };
      if (can.raise && roll < style.bluff * 0.5) return raiseTo(table, i, can, 0.75); // a steal
      return { do: 'fold' };
    }
    // Someone raised.
    const need = 7 + Math.min(5, facing / 2);
    if (score >= need + 3 && can.raise && roll < 0.3 + style.aggro * 0.6) return raiseTo(table, i, can, 1);
    if (score >= need - style.sticky * 20 || (owe <= table.bb && score >= 4)) return { do: 'call' };
    if (can.raise && roll < style.bluff * 0.3) return raiseTo(table, i, can, 1);
    return passive;
  }

  let win = equity(me.cards, h.board, opponents, random, 200);
  if (owe > 0) win *= 1 - 0.3 * Math.min(1, owe / Math.max(1, pot - owe)); // they bet: they've probably got something
  const strong = 0.72 - style.aggro * 0.12;
  const good = 0.5 - style.aggro * 0.06;
  if (owe === 0) {
    if (win > good && can.raise && roll < 0.35 + style.aggro * 0.55) return raiseTo(table, i, can, win > strong ? 0.7 : 0.5);
    if (can.raise && roll < style.bluff * (h.street === 'river' ? 1.4 : 1) / Math.max(1, opponents - 1)) return raiseTo(table, i, can, 0.55);
    return { do: 'check' };
  }
  if (win > strong && can.raise && roll < 0.3 + style.aggro * 0.6) return raiseTo(table, i, can, 0.8);
  if (win >= odds - style.sticky || (owe <= table.bb && win > 0.15)) return { do: 'call' };
  return { do: 'fold' };
}

// How long a bot seems to think, in ms (the online tables wait this long before it acts).
export const thinkTime = (random = Math.random) => 700 + Math.floor(random() * 1100);
