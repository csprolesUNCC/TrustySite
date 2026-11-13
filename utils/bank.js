import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { LIMITS, STALE_MS, GAMES, isBetId, signedOp, maxPayout } from './bank-rules.js';

// The click bank: betting site clicks at Trusty Blackjack (on your own and at the online tables), Trusty Craps and
// on online Trusty Fever games,
// served from api/leaderboard.js as ?action=bank so it doesn't take up another Vercel function. Clicks live in
// `click_game` (one document per account: the header clicker's total), and every bet and every payout is one
// atomic update of that document, so two tabs or a retried request can never spend the same clicks twice or be
// paid twice. Open bets are kept on the document too (`bank.open.<betId>`) until they're settled.
//   GET (logged in): { clicks, net, refunded, limits, month }: your clicks, how far up or down you are today,
//     and this month's result per game. It also gives back bets that were never settled after STALE_MS (their
//     table or room went away), and says how many clicks that returned.
//   POST { payload, sig }: only from the room server (realtime/), which signs the JSON payload with FEVER_SECRET
//     (utils/fever-ticket.js), so nobody else can move clicks. The payload has `ts` (refused when over a
//     minute old) and an `op`:
//     stake { userId, betId, amount, game }: takes a bet off the player's clicks, within the limits.
//     settle { bets: [{ userId, betId, payout }] }: pays bets out (0 for a lost one), once each.
//     pot { potId, stakes: [{ userId, betId }], winners: [userId] }: a Trusty Fever pot. The bank adds up what it
//       holds for those stakes itself, splits it between the winners, and writes the split down (`fever_pots`)
//       so a retry pays exactly the same.
// Limits: at most `maxStake` on one bet, and once you're `lossPerDay` down or `winPerDay` up for the day (Eastern
// time, like Trustle) no more bets until midnight. Open bets count as lost until they're settled. Clicks can't
// be bought or sent to anyone: keep it that way, or this stops being play money.

export { LIMITS, STALE_MS, signedOp };

const POT_DAYS = 30;
const unwrap = (result) => (result && 'value' in result ? result.value : result);
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayOf = (date) => dayFormat.format(date); // YYYY-MM-DD, in Eastern time
export const monthOf = (date) => dayOf(date).slice(0, 7);
const fmt = (n) => new Intl.NumberFormat('en-US').format(n);

// The first bet or payout of a new day starts the day's running total from zero.
async function rollover(col, userId, today) {
  await col.updateOne({ userId, 'bank.day': { $ne: today } }, { $set: { 'bank.day': today, 'bank.net': 0 } });
}

// solo: a bet from a one-player game on the site's API (Blackjack on your own, Craps), which looks after its own
// open bets, so refundStale() leaves it alone: otherwise walking away from a bad hand for 2 hours would get the bet
// back.
export async function stake(col, { userId, betId, amount, game, solo = false }, now = new Date()) {
  const today = dayOf(now);
  await rollover(col, userId, today);
  const done = unwrap(await col.findOneAndUpdate(
    {
      userId,
      clicks: { $gte: amount },
      'bank.day': today,
      'bank.net': { $gte: amount - LIMITS.lossPerDay, $lt: LIMITS.winPerDay },
      [`bank.open.${betId}`]: { $exists: false },
    },
    {
      $inc: { clicks: -amount, 'bank.net': -amount },
      $set: { [`bank.open.${betId}`]: { amount, game, day: today, at: now, ...(solo === true ? { solo: true } : {}) } },
    },
    { returnDocument: 'after', projection: { clicks: 1, 'bank.net': 1 } },
  ));
  if (done) return { ok: true, clicks: done.clicks, net: done.bank.net };

  // Why not?
  const doc = await col.findOne({ userId }, { projection: { clicks: 1, bank: 1 } });
  if (!doc) return { ok: false, error: 'You don’t have any clicks yet: click Trusty at the top of the page to earn some.' };
  if (doc.bank && doc.bank.open && doc.bank.open[betId]) return { ok: true, clicks: doc.clicks, net: doc.bank.net }; // a retry
  const net = doc.bank && doc.bank.day === today ? doc.bank.net : 0;
  if ((doc.clicks || 0) < amount) return { ok: false, error: `You only have ${fmt(doc.clicks || 0)} clicks.` };
  if (net >= LIMITS.winPerDay) return { ok: false, error: `You’re ${fmt(net)} clicks up today: that’s the daily limit. Come back after midnight!` };
  return { ok: false, error: `That could put you more than ${fmt(LIMITS.lossPerDay)} clicks down today, the daily limit. Bet less, or come back after midnight.` };
}

// Pays one open bet out, once. Returns the player's new { clicks, bank: { net } }, or null if it was already done.
async function close(col, userId, betId, bet, payout, now) {
  const today = dayOf(now);
  await rollover(col, userId, today);
  return unwrap(await col.findOneAndUpdate(
    { userId, [`bank.open.${betId}.at`]: bet.at },
    {
      $unset: { [`bank.open.${betId}`]: '' },
      $inc: {
        clicks: payout,
        // A bet from an earlier day was already counted against that day.
        'bank.net': bet.day === today ? payout : payout - bet.amount,
        [`bank.stats.${bet.game}.${monthOf(now)}`]: payout - bet.amount,
      },
    },
    { returnDocument: 'after', projection: { clicks: 1, 'bank.net': 1 } },
  ));
}

async function openBet(col, userId, betId) {
  const doc = await col.findOne({ userId, [`bank.open.${betId}`]: { $exists: true } }, { projection: { [`bank.open.${betId}`]: 1 } });
  return doc ? doc.bank.open[betId] : null;
}

// A payout over maxPayout() (3 times a Blackjack bet, 8 times a Craps one, a refund otherwise) is refused.
export async function settle(col, bets, now = new Date()) {
  const balances = {};
  for (const { userId, betId, payout } of bets) {
    const bet = await openBet(col, userId, betId);
    if (!bet) continue; // already settled (a retry), or given back
    if (payout > maxPayout(bet)) {
      console.error(`Bank: refused to pay ${payout} on a ${bet.amount}-click ${bet.game} bet.`);
      continue;
    }
    const after = await close(col, userId, betId, bet, payout, now);
    if (after) balances[userId] = { clicks: after.clicks, net: after.bank.net };
  }
  return { ok: true, balances };
}

export async function settlePot(col, pots, { potId, stakes, winners }, now = new Date()) {
  let record = await pots.findOne({ _id: potId });
  if (!record) {
    const held = [];
    for (const { userId, betId } of stakes) {
      const bet = await openBet(col, userId, betId);
      if (bet && bet.game === 'fever') held.push({ userId, betId, amount: bet.amount });
    }
    const total = held.reduce((sum, h) => sum + h.amount, 0);
    const takers = held.filter((h) => winners.includes(h.userId));
    const share = takers.length ? Math.floor(total / takers.length) : 0;
    record = {
      _id: potId,
      total,
      // Nobody to give it to (the winners never paid in): everyone gets their stake back.
      payouts: held.map((h) => ({ ...h, payout: takers.length ? (takers.includes(h) ? share : 0) : h.amount })),
      expiresAt: new Date(now.getTime() + POT_DAYS * 864e5),
    };
    try {
      await pots.insertOne(record);
    } catch (error) {
      if (error && error.code === 11000) record = await pots.findOne({ _id: potId }); // a retry got there first
      else throw error;
    }
  }
  // Losers first: if this stops halfway, a retry finishes it, and it can never pay out more than the pot.
  const balances = {};
  for (const p of [...record.payouts].sort((a, b) => a.payout - b.payout)) {
    const bet = await openBet(col, p.userId, p.betId);
    if (!bet) continue;
    const after = await close(col, p.userId, p.betId, bet, p.payout, now);
    if (after) balances[p.userId] = { clicks: after.clicks, net: after.bank.net };
  }
  return { ok: true, total: record.total, payouts: record.payouts.map(({ userId, payout }) => ({ userId, payout })), balances };
}

// Gives back bets left open for STALE_MS: their table or room went away before paying out. Solo bets are never
// given back here: solo Blackjack stands and settles a hand left alone itself, and a Craps bet stays on the table
// until its player rolls again.
export async function refundStale(col, userId, now = new Date()) {
  const doc = await col.findOne({ userId }, { projection: { 'bank.open': 1 } });
  const open = doc && doc.bank && doc.bank.open;
  if (!open) return 0;
  const today = dayOf(now);
  let back = 0;
  for (const [betId, bet] of Object.entries(open)) {
    if (!isBetId(betId) || bet.solo || now - new Date(bet.at) < STALE_MS) continue;
    const result = await col.updateOne(
      { userId, [`bank.open.${betId}.at`]: bet.at },
      { $unset: { [`bank.open.${betId}`]: '' }, $inc: { clicks: bet.amount, 'bank.net': bet.day === today ? bet.amount : 0 } },
    );
    if (result.modifiedCount) back += bet.amount;
  }
  return back;
}

export async function status(col, userId, now = new Date()) {
  const refunded = await refundStale(col, userId, now);
  const doc = await col.findOne({ userId }, { projection: { clicks: 1, bank: 1 } });
  const bank = (doc && doc.bank) || {};
  const month = monthOf(now);
  const stats = bank.stats || {};
  return {
    clicks: (doc && doc.clicks) || 0,
    net: bank.day === dayOf(now) ? bank.net : 0,
    refunded,
    limits: LIMITS,
    month: Object.fromEntries(GAMES.map((game) => [game, (stats[game] && stats[game][month]) || 0])),
  };
}

let potIndex = null;
async function potsCollection(db) {
  const pots = db.collection('fever_pots');
  potIndex ??= pots.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { potIndex = null; });
  return pots;
}

export default async function bank(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const user = authenticateUser(req);
      if (!user || user.userId == null) return res.status(401).json({ error: 'Authentication required' });
      const db = await connectToDatabase();
      return res.status(200).json(await status(db.collection('click_game'), String(user.userId)));
    }
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    const op = await signedOp(req.body, process.env.FEVER_SECRET);
    if (!op) return res.status(403).json({ error: 'Not a request from the room server' });
    const db = await connectToDatabase();
    const col = db.collection('click_game');
    if (op.op === 'stake') return res.status(200).json(await stake(col, op));
    if (op.op === 'settle') return res.status(200).json(await settle(col, op.bets));
    return res.status(200).json(await settlePot(col, await potsCollection(db), op));
  } catch (error) {
    console.error('Bank API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
