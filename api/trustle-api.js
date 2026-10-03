import { connectToDatabase } from './db.js';
import { authenticateUser } from '../utils/auth.js';
import { puzzleNumber, cleanGame, mergeGame, sameGame } from '../scripts/trustle.js';

// Keeps a logged-in player's Trustle history so it follows them between devices.
// POST { games: { [puzzle number]: game } } merges those games into the account (the same way the page
// merges them, see scripts/trustle.js) and answers with the account's whole history: { games }.
// Sending {} just fetches it.

const MAX_GAMES = 1000;

export default async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const sent = req.body && typeof req.body.games === 'object' && req.body.games ? req.body.games : {};
    const keys = Object.keys(sent);
    if (keys.length > MAX_GAMES) return res.status(400).json({ error: 'Too many games' });

    try {
        const db = await connectToDatabase();
        const collection = db.collection('trustle');
        const doc = await collection.findOne({ userId: user.userId });
        const games = (doc && doc.games) || {};

        // Puzzles that haven't started yet can't have been played (one day of slack for clock trouble).
        const latest = puzzleNumber() + 1;
        const changes = {};
        for (const key of keys) {
            const n = Number(key);
            if (!(n <= latest)) continue;
            const game = cleanGame(n, sent[key]);
            if (!game) continue;
            const merged = mergeGame(games[n] && cleanGame(n, games[n]), game);
            if (!sameGame(merged, games[n])) {
                games[n] = merged;
                changes[`games.${n}`] = merged;
            }
        }

        if (Object.keys(changes).length) {
            await collection.updateOne(
                { userId: user.userId },
                { $set: { ...changes, username: user.username, updatedAt: new Date() } },
                { upsert: true }
            );
        }
        return res.status(200).json({ games });
    } catch (error) {
        console.error('Trustle API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
