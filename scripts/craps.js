// Trusty Craps rules: pure functions, no DOM, shared by the page (pages/games/craps.html, to label and check bets),
// the game on your own (utils/solo-craps-game.js) and the online tables (realtime/craps-table.js), which roll the
// dice. All plain data, so the tests can pick the
// dice.
//
// The table: Pass Line and Don't Pass on the come-out roll, Odds behind the Pass Line once there's a point, and
// three one-roll bets (Field, Any Seven, Any Craps) on any roll. A table is { point: null | 4..10, bets: { [spot]:
// { id, amount } } }; one-roll bets never stay on it.

// Bets in tens (like Blackjack's), so 3:2 and 6:5 odds always pay whole clicks.
export const BETS = { min: 10, max: 500, step: 10 };
export const isBet = (n) => Number.isSafeInteger(n) && n >= BETS.min && n <= BETS.max && n % BETS.step === 0;
// Odds behind the Pass Line: up to this many times the Pass Line bet.
export const ODDS_TIMES = 2;
export const POINTS = [4, 5, 6, 8, 9, 10];
export const SPOTS = ['pass', 'dontPass', 'odds', 'field', 'seven', 'craps'];
export const ONE_ROLL = ['field', 'seven', 'craps'];
export const NAMES = { pass: 'Pass Line', dontPass: 'Don’t Pass', odds: 'Odds', field: 'Field', seven: 'Any Seven', craps: 'Any Craps' };
// What the true odds behind the line pay on each point, as [win, per].
const ODDS_PAY = { 4: [2, 1], 10: [2, 1], 5: [3, 2], 9: [3, 2], 6: [6, 5], 8: [6, 5] };
// The most any bet pays back, as a multiple of what was bet (Any Craps: 7 to 1). utils/bank.js caps payouts at it.
export const MAX_RETURN = 8;

export const newTable = () => ({ point: null, bets: {} });
// Bump whenever a message between pages/games/craps.html and the online tables (realtime/craps-table.js) changes
// shape: a page and a table that don't match then refuse each other with "reload".
export const CRAPS_PROTOCOL = 1;

// New bets from a request or a message, { [spot]: amount }, or null if anything in it isn't a bet.
export function cleanBets(sent) {
  if (sent == null) return {};
  if (typeof sent !== 'object' || Array.isArray(sent)) return null;
  const bets = {};
  for (const [spot, amount] of Object.entries(sent)) {
    if (!SPOTS.includes(spot) || !isBet(amount)) return null;
    bets[spot] = amount;
  }
  return bets;
}

// Why these new bets can't go down on this table now, or null. (Each spot takes one bet until it's decided.)
export function betProblem(table, bets) {
  for (const [spot, amount] of Object.entries(bets)) {
    if (table.bets[spot]) return spot === 'odds' ? 'Your Odds are already down.' : `You already have a bet on ${NAMES[spot]}.`;
    if (!canBet(table, spot)) {
      if (spot === 'odds') return table.point == null ? 'Odds go behind the Pass Line once there’s a point.' : 'Odds need a Pass Line bet.';
      return 'Line bets go down on the come-out roll, before there’s a point.';
    }
    if (spot === 'odds' && amount > oddsMax(table.bets.pass.amount)) return `Odds can be up to ${ODDS_TIMES} times your Pass Line bet.`;
  }
  return null;
}

// Whether a bet can go on this spot now (amount aside from the odds limit, which oddsMax() gives).
export function canBet(table, spot) {
  if (!SPOTS.includes(spot)) return false;
  if (ONE_ROLL.includes(spot)) return true;
  if (spot === 'odds') return table.point != null && Boolean(table.bets.pass) && !table.bets.odds;
  return table.point == null && !table.bets[spot];
}

// The most Odds can be with this much on the Pass Line.
export const oddsMax = (pass) => Math.min(BETS.max, pass * ODDS_TIMES);

// What `amount` on `spot` pays back in total (stake included) when it wins on this roll. Odds need the point.
export function winReturn(spot, amount, sum, point) {
  if (spot === 'odds') {
    const [win, per] = ODDS_PAY[point];
    return amount + (amount * win) / per;
  }
  if (spot === 'field') return amount * (sum === 2 ? 3 : sum === 12 ? 4 : 2);
  if (spot === 'seven') return amount * 5;
  if (spot === 'craps') return amount * 8;
  return amount * 2;
}

// What the roll does to each bet: 'win', 'lose', 'push' or null (stays up).
function outcome(spot, sum, point) {
  if (spot === 'field') return [2, 3, 4, 9, 10, 11, 12].includes(sum) ? 'win' : 'lose';
  if (spot === 'seven') return sum === 7 ? 'win' : 'lose';
  if (spot === 'craps') return [2, 3, 12].includes(sum) ? 'win' : 'lose';
  if (point == null) {
    if (spot === 'pass') return sum === 7 || sum === 11 ? 'win' : [2, 3, 12].includes(sum) ? 'lose' : null;
    if (spot === 'dontPass') return sum === 2 || sum === 3 ? 'win' : sum === 12 ? 'push' : sum === 7 || sum === 11 ? 'lose' : null;
    return null;
  }
  if (sum === point) return spot === 'dontPass' ? 'lose' : 'win';
  if (sum === 7) return spot === 'dontPass' ? 'win' : 'lose';
  return null;
}

// Where the point goes after this roll.
export function nextPoint(point, dice) {
  const sum = dice[0] + dice[1];
  if (point == null) return POINTS.includes(sum) ? sum : null;
  return sum === point || sum === 7 ? null : point;
}

// Rolls `dice` ([1-6, 1-6]) on the table (changing it) and returns what was decided:
// [{ spot, id, amount, result, payout }], payout being the clicks paid back (0 for a loss).
export function roll(table, dice) {
  const sum = dice[0] + dice[1];
  const point = table.point;
  const decided = [];
  for (const spot of SPOTS) {
    const bet = table.bets[spot];
    if (!bet) continue;
    const result = outcome(spot, sum, point);
    if (!result) continue;
    const payout = result === 'win' ? winReturn(spot, bet.amount, sum, point) : result === 'push' ? bet.amount : 0;
    decided.push({ spot, id: bet.id, amount: bet.amount, result, payout });
    delete table.bets[spot];
  }
  table.point = nextPoint(point, dice);
  return decided;
}

// What a roll sounds like at the table.
export function callOut(dice, point) {
  const sum = dice[0] + dice[1];
  if (point == null) {
    if (sum === 7 || sum === 11) return `${sum}, a natural!`;
    if (sum === 2) return 'Snake eyes: craps!';
    if (sum === 3 || sum === 12) return `${sum}, craps!`;
    return `${sum}: the point is ${sum}.`;
  }
  if (sum === point) return `${sum}: hit the point!`;
  if (sum === 7) return 'Seven out!';
  return `${sum}. The point is still ${point}.`;
}
