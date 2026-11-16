import { verifyPayload } from './fever-ticket.js';

// The click bank's limits and what a request to it has to look like (utils/bank.js does the banking). No
// database here, so tools/dev-server.mjs's pretend bank checks requests exactly the same way.

export const LIMITS = { maxStake: 500, lossPerDay: 5000, winPerDay: 5000 };
// Bigger players get a bigger daily limit (both ways), going by their clicks not counting today's bets
// (limitBasis()), so winning or losing doesn't move it mid-day. The steps are click ranks in scripts/milestones.js:
// Stallion, Trusty's Best Friend and Triple Crown. Highest first.
export const LIMIT_TIERS = [
  { at: 250000, perDay: 50000 },
  { at: 50000, perDay: 25000 },
  { at: 5000, perDay: 10000 },
];
export function limitsFor(basis) {
  const tier = LIMIT_TIERS.find((t) => basis >= t.at);
  return tier ? { ...LIMITS, lossPerDay: tier.perDay, winPerDay: tier.perDay } : LIMITS;
}
// The clicks a player's limit goes by: what they have, minus what today's bets have won or lost (`net`, today's).
export const limitBasis = (clicks, net) => Math.max(0, (clicks || 0) - (net || 0));
export const STALE_MS = 2 * 60 * 60 * 1000;
export const FRESH_MS = 60 * 1000;
const BET_ID = /^[0-9a-f]{16}$/;
export const GAMES = ['blackjack', 'fever', 'craps', 'slots'];
const ROOM_GAMES = ['blackjack', 'fever', 'craps']; // what the room server can bet on (Slots only spin on the site's API)
// The most one settled bet can pay back, as a multiple of what was bet: Blackjack's insurance pays 2 to 1 (3x),
// Craps' Any Craps 7 to 1 (8x, MAX_RETURN in scripts/craps.js), a Slots spin at most 754 times the bet (its
// own jackpot plus the jackpot on all 8 free spins of the bonus: MAX_RETURN in scripts/slots.js). Anything else is a refund at most.
export const MAX_RETURN = { blackjack: 3, craps: 8, slots: 754 };
export const maxPayout = (bet) => bet.amount * (MAX_RETURN[bet.game] || 1);
const MAX_BETS = 64;

export const isUserId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
export const isBetId = (v) => typeof v === 'string' && BET_ID.test(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

// A request's op, if the room server signed it in the last minute and it makes sense.
export async function signedOp(body, secret, now = Date.now()) {
  const { payload, sig } = body || {};
  if (!(await verifyPayload(payload, sig, secret))) return null;
  let op;
  try { op = JSON.parse(payload); } catch { return null; }
  if (!op || typeof op !== 'object' || !Number.isSafeInteger(op.ts) || Math.abs(now - op.ts) > FRESH_MS) return null;
  if (op.op === 'stake') {
    const ok = isUserId(op.userId) && isBetId(op.betId) && Number.isSafeInteger(op.amount)
      && op.amount >= 1 && op.amount <= LIMITS.maxStake && ROOM_GAMES.includes(op.game);
    return ok ? { op: 'stake', userId: op.userId, betId: op.betId, amount: op.amount, game: op.game } : null;
  }
  if (op.op === 'settle') {
    if (!Array.isArray(op.bets) || !op.bets.length || op.bets.length > MAX_BETS) return null;
    const bets = op.bets.map((b) => (b && isUserId(b.userId) && isBetId(b.betId) && isCount(b.payout) ? { userId: b.userId, betId: b.betId, payout: b.payout } : null));
    return bets.every(Boolean) ? { op: 'settle', bets } : null;
  }
  if (op.op === 'pot') {
    if (!isBetId(op.potId) || !Array.isArray(op.stakes) || !op.stakes.length || op.stakes.length > 6 || !Array.isArray(op.winners)) return null;
    const stakes = op.stakes.map((s) => (s && isUserId(s.userId) && isBetId(s.betId) ? { userId: s.userId, betId: s.betId } : null));
    if (!stakes.every(Boolean) || new Set(stakes.map((s) => s.userId)).size !== stakes.length) return null;
    if (op.winners.length > 6 || !op.winners.every((w) => stakes.some((s) => s.userId === w))) return null;
    return { op: 'pot', potId: op.potId, stakes, winners: op.winners };
  }
  return null;
}

