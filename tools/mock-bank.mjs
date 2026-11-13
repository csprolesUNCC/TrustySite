// A stand-in for the click bank (utils/bank.js) that keeps everything in memory, for the rooms and tables that
// tools/dev-server.mjs runs and for the tests. Same answers and limits as the real one; nothing is saved, and
// everyone starts with `startingClicks` (the pretend API's header clicker says 12,345 too).

import { LIMITS, GAMES, maxPayout } from '../utils/bank-rules.js';

export function mockBank({ startingClicks = 12345, delay = 5 } = {}) {
  const accounts = new Map();
  const pots = new Map();
  const later = () => new Promise((r) => setTimeout(r, delay)); // the real bank is a request away
  const account = (userId) => {
    if (!accounts.has(userId)) accounts.set(userId, { clicks: startingClicks, net: 0, open: new Map(), month: Object.fromEntries(GAMES.map((g) => [g, 0])) });
    return accounts.get(userId);
  };
  const fmt = (n) => new Intl.NumberFormat('en-US').format(n);

  async function stake({ userId, betId, amount, game, solo = false }) {
    await later();
    const a = account(userId);
    if (a.open.has(betId)) return { ok: true, clicks: a.clicks, net: a.net };
    if (!Number.isInteger(amount) || amount < 1 || amount > LIMITS.maxStake) return { ok: false, error: 'That’s not a bet.' };
    if (a.clicks < amount) return { ok: false, error: `You only have ${fmt(a.clicks)} clicks.` };
    if (a.net >= LIMITS.winPerDay) return { ok: false, error: `You’re ${fmt(a.net)} clicks up today: that’s the daily limit. Come back after midnight!` };
    if (a.net - amount < -LIMITS.lossPerDay) return { ok: false, error: `That could put you more than ${fmt(LIMITS.lossPerDay)} clicks down today, the daily limit. Bet less, or come back after midnight.` };
    a.clicks -= amount;
    a.net -= amount;
    a.open.set(betId, { amount, game, solo: solo === true });
    return { ok: true, clicks: a.clicks, net: a.net };
  }

  function close(userId, betId, payout, balances) {
    const a = account(userId);
    const bet = a.open.get(betId);
    if (!bet) return;
    a.open.delete(betId);
    a.clicks += payout;
    a.net += payout;
    a.month[bet.game] += payout - bet.amount;
    balances[userId] = { clicks: a.clicks, net: a.net };
  }

  async function settle(bets) {
    await later();
    const balances = {};
    for (const { userId, betId, payout } of bets) {
      const bet = account(userId).open.get(betId);
      if (bet && payout <= maxPayout(bet)) close(userId, betId, payout, balances);
    }
    return { ok: true, balances };
  }

  async function pot({ potId, stakes, winners }) {
    await later();
    if (!pots.has(potId)) {
      const held = stakes.filter((s) => account(s.userId).open.has(s.betId)).map((s) => ({ ...s, amount: account(s.userId).open.get(s.betId).amount }));
      const total = held.reduce((sum, h) => sum + h.amount, 0);
      const takers = held.filter((h) => winners.includes(h.userId));
      const share = takers.length ? Math.floor(total / takers.length) : 0;
      pots.set(potId, { total, payouts: held.map((h) => ({ ...h, payout: takers.length ? (takers.includes(h) ? share : 0) : h.amount })) });
    }
    const record = pots.get(potId);
    const balances = {};
    for (const p of [...record.payouts].sort((x, y) => x.payout - y.payout)) close(p.userId, p.betId, p.payout, balances);
    return { ok: true, total: record.total, payouts: record.payouts.map(({ userId, payout }) => ({ userId, payout })), balances };
  }

  function status(userId) {
    const a = account(userId);
    return { clicks: a.clicks, net: a.net, refunded: 0, limits: LIMITS, month: { ...a.month } };
  }

  // The house's side of everyone's bets (utils/house.js does the same from the real bank's stats).
  function house() {
    const games = {};
    for (const a of accounts.values()) for (const [game, n] of Object.entries(a.month)) games[game] = (games[game] || 0) - n;
    return { total: Object.values(games).reduce((x, y) => x + y, 0), games };
  }

  return { stake, settle, pot, status, account, house };
}
