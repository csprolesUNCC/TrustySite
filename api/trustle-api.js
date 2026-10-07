import { connectToDatabase } from '../utils/db.js';
import { authenticateUser } from '../utils/auth.js';
import { MAX_GUESSES, puzzleNumber, cleanGame, outcome, mergeGame, sameGame } from '../scripts/trustle.js';

// Keeps a logged-in player's Trustle history so it follows them between devices.
// POST { games: { [puzzle number]: game } } merges those games into the account (the same way the page
// merges them, see scripts/trustle.js) and answers with the account's whole history: { games }.
// Sending {} just fetches it.
// GET ?n=<puzzle number> is "how everyone else did": counted from the same histories, so nothing extra is
// stored. Public; when logged in, your own game is left out.

const MAX_GAMES = 1000;

// { players, dist, lost } for puzzle `n`: finished games only, `dist[i]` is how many got it in i + 1. Days
// rebuilt from the old stats (legacy) only roughly match their puzzle, so they don't count.
async function everyone(req, res) {
    const n = Number(req.query.n);
    if (!Number.isInteger(n) || n < 1 || n > puzzleNumber() + 1) return res.status(400).json({ error: 'Invalid puzzle' });
    const user = authenticateUser(req);

    const db = await connectToDatabase();
    const docs = await db.collection('trustle').find(
        { [`games.${n}`]: { $exists: true }, ...(user && { userId: { $ne: user.userId } }) },
        { projection: { _id: 0, [`games.${n}`]: 1 } }
    ).toArray();

    const counts = { players: 0, dist: Array(MAX_GUESSES).fill(0), lost: 0 };
    for (const doc of docs) {
        const game = cleanGame(n, doc.games && doc.games[n]);
        if (!game || game.legacy) continue;
        const result = outcome(n, game);
        if (!result.done) continue;
        counts.players += 1;
        if (result.won) counts.dist[result.tries - 1] += 1;
        else counts.lost += 1;
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(counts);
}

export default async (req, res) => {
    if (req.method === 'GET') {
        try {
            return await everyone(req, res);
        } catch (error) {
            console.error('Trustle API Error:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }
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
