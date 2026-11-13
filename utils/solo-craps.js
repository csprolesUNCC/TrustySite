import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { stake, settle, status } from './bank.js';
import { play, cleanMove, defaults } from './solo-craps-game.js';
import { mongoGames } from './solo-store.js';

// Trusty Craps, for clicks: served from api/leaderboard.js as ?action=craps so it doesn't take up another Vercel
// function. The dice are rolled here and the table (what's on it, the point) is kept in the database
// (`craps_solo`, one document per account): dice rolled in the browser could be rigged to win clicks.
//   GET: { table: { point, bets: { [spot]: amount } }, last (the last roll: dice, point before it, what it
//     decided), history (recent sums), rolls, bets (limits), oddsTimes, bank: { clicks, net }, limits, refunded }.
//     It also pays out a roll whose payout didn't get through.
//   POST { do: 'roll', bets: { [spot]: amount } }: puts those bets down and rolls. The same answer, with `bank`
//     only when your clicks changed, and `error` when the bets weren't allowed or the bank said no.
// The rules are scripts/craps.js; the game is utils/solo-craps-game.js.

export default async function soloCraps(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
    const user = authenticateUser(req);
    if (!user || user.userId == null) return res.status(401).json({ error: 'Authentication required' });
    const move = req.method === 'POST' ? cleanMove(req.body) : null;
    if (req.method === 'POST' && !move) return res.status(400).json({ error: 'That’s not a bet.' });

    const userId = String(user.userId);
    const db = await connectToDatabase();
    const clicks = db.collection('click_game');
    const deps = {
      ...defaults,
      ...mongoGames(db.collection('craps_solo')),
      bank: { stake: (op) => stake(clicks, op), settle: (bets) => settle(clicks, bets) },
    };
    const game = await play(deps, userId, move);
    if (!move) {
      const mine = await status(clicks, userId);
      Object.assign(game, { bank: { clicks: mine.clicks, net: mine.net }, limits: mine.limits, refunded: mine.refunded });
    }
    return res.status(200).json(game);
  } catch (error) {
    console.error('Craps API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
