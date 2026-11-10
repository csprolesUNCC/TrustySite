import { verifyPayload } from './fever-ticket.js';

// The click bank's limits and what a request to it has to look like (utils/bank.js does the banking). No
// database here, so tools/dev-server.mjs's pretend bank checks requests exactly the same way.

export const LIMITS = { maxStake: 500, lossPerDay: 5000, winPerDay: 5000 };
export const STALE_MS = 2 * 60 * 60 * 1000;
export const FRESH_MS = 60 * 1000;
const BET_ID = /^[0-9a-f]{16}$/;
export const GAMES = ['blackjack', 'fever'];
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
      && op.amount >= 1 && op.amount <= LIMITS.maxStake && GAMES.includes(op.game);
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

