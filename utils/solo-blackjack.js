import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { stake, settle, status } from './bank.js';
import { play, cleanMove, defaults } from './solo-blackjack-game.js';
import { mongoGames } from './solo-store.js';

// Trusty Blackjack for one player, for clicks, with no room server: served from api/leaderboard.js as
// ?action=blackjack so it doesn't take up another Vercel function. The online tables (realtime/table.js) need a
// room server to keep several people in step; one player doesn't, so each move is just a request here. The
// cards are dealt here and the shoe stays in the database (`blackjack_solo`, one document per account), so the
// page only ever sees what's face up: a game dealt in the browser could be rigged to win clicks.
//   GET: { hand, shuffled, round (scripts/blackjack.js view(), hole card hidden), bets, bank: { clicks, net },
//     limits, refunded }. It also plays out a hand left alone for STALE_HAND_MS (stands everything) and pays
//     out a finished one whose payout didn't get through.
//   POST { do: 'deal', amount } | { do: 'insure', take } | { do: 'hit' | 'stand' | 'double' | 'split' }: the same,
//     with `bank` only when your clicks changed, and `error` when the move wasn't allowed or the bank said no.
// Money goes through the click bank (utils/bank.js) exactly as at the tables: every bet, double, split and
// insurance is staked before it counts, and the hand is settled once it's over. Trusty plays his whole turn
// within the move that ends yours; the page turns his cards over one at a time.
//
// Two tabs: every save checks the document's version (`v`) is still the one this move started from. If another
// tab got there first, this move's stake goes back and the page gets the game as it is now.

export { mongoGames }; // utils/solo-store.js

export default async function soloBlackjack(req, res) {
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
      ...mongoGames(db.collection('blackjack_solo')),
      bank: { stake: (op) => stake(clicks, op), settle: (bets) => settle(clicks, bets) },
    };
    const game = await play(deps, userId, move);
    if (!move) {
      const mine = await status(clicks, userId);
      Object.assign(game, { bank: { clicks: mine.clicks, net: mine.net }, limits: mine.limits, refunded: mine.refunded });
    }
    return res.status(200).json(game);
  } catch (error) {
    console.error('Solo Blackjack API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
