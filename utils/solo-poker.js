import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { stake, settle, status } from './bank.js';
import { play, cleanMove, defaults } from './solo-poker-game.js';
import { mongoGames } from './solo-store.js';

// Trusty Poker against the bots, for clicks: served from api/leaderboard.js as ?action=poker so it doesn't take up
// another Vercel function. The cards are dealt and the bots play here, and the table (the deck, everyone's cards)
// is kept in the database (`poker_solo`, one document per account), so the page only ever sees your own cards and
// what's been shown down: a game dealt in the browser could be rigged to win clicks.
//   GET: { table (scripts/poker.js view(), from your seat), sit: { buyIn, bots } or null, last (your last cash-out),
//     stakes, cashOutTimes, bank: { clicks, net }, limits, refunded }. It also plays out and cashes out a sit left
//     alone for an hour, and pays out a cash-out whose payout didn't get through.
//   POST { do: 'sit', buyIn, bots } | { do: 'act', action: { do: 'fold' | 'check' | 'call' } | { do: 'raise', to } }
//     | { do: 'next' } | { do: 'leave' }: the same, with `bank` only when your clicks changed and `error` when the
//     move wasn't allowed or the bank said no. `table.hand.log` is what happened during the move, for the page to
//     show a step at a time.
// The rules are scripts/poker.js, the bots scripts/poker-bots.js, the game utils/solo-poker-game.js.

export default async function soloPoker(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
    const user = authenticateUser(req);
    if (!user || user.userId == null) return res.status(401).json({ error: 'Authentication required' });
    const move = req.method === 'POST' ? cleanMove(req.body) : null;
    if (req.method === 'POST' && !move) return res.status(400).json({ error: 'That’s not a move.' });

    const userId = String(user.userId);
    const db = await connectToDatabase();
    const clicks = db.collection('click_game');
    const deps = {
      ...defaults,
      ...mongoGames(db.collection('poker_solo')),
      bank: { stake: (op) => stake(clicks, op), settle: (bets) => settle(clicks, bets) },
    };
    const game = await play(deps, userId, move);
    if (!move) {
      const mine = await status(clicks, userId);
      Object.assign(game, { bank: { clicks: mine.clicks, net: mine.net }, limits: mine.limits, refunded: mine.refunded });
    }
    return res.status(200).json(game);
  } catch (error) {
    console.error('Poker API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
