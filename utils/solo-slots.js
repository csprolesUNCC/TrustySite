import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { stake, settle, status } from './bank.js';
import { play, cleanMove, defaults } from './solo-slots-game.js';
import { mongoGames } from './solo-store.js';

// Trusty Slots, for clicks: served from api/leaderboard.js as ?action=slots so it doesn't take up another Vercel
// function. The reels are spun here, never in the browser: a spin decided on the page could be rigged to win
// clicks. Each account's last spin is kept in the database (`slots_solo`, one document per account) so a payout
// that didn't get through can be paid on the next visit.
//   GET: { last (the last spin: machine, stops, line, amount, times, kind, symbol, payout), spins, bets (limits),
//     bank: { clicks, net }, limits, refunded }. It also pays out a spin whose payout didn't get through.
//   POST { do: 'spin', machine, amount }: bets and spins. The same answer, with `bank` only when your clicks
//     changed, and `error` when the bank said no.
// The rules and the machines are scripts/slots.js; the game is utils/solo-slots-game.js.

export default async function soloSlots(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
    const user = authenticateUser(req);
    if (!user || user.userId == null) return res.status(401).json({ error: 'Authentication required' });
    const move = req.method === 'POST' ? cleanMove(req.body) : null;
    if (req.method === 'POST' && !move) return res.status(400).json({ error: 'That’s not a spin.' });

    const userId = String(user.userId);
    const db = await connectToDatabase();
    const clicks = db.collection('click_game');
    const deps = {
      ...defaults,
      ...mongoGames(db.collection('slots_solo')),
      bank: { stake: (op) => stake(clicks, op), settle: (bets) => settle(clicks, bets) },
    };
    const game = await play(deps, userId, move);
    if (!move) {
      const mine = await status(clicks, userId);
      Object.assign(game, { bank: { clicks: mine.clicks, net: mine.net }, limits: mine.limits, refunded: mine.refunded });
    }
    return res.status(200).json(game);
  } catch (error) {
    console.error('Slots API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
