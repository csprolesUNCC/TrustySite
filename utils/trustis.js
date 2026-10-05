import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';

// The Trustis leaderboard (pages/games/trustis.html), served from api/leaderboard.js as ?action=trustis so it
// doesn't take up another Vercel function. `trustis_scores` keeps each player's best game.
//   GET: the top 10, [{ name, score }].
//   GET &personal=1: the logged-in player's best, { highScore } (0 when logged out).
//   POST { score, lines, level }: a finished game. Saved (201) if it beats the player's best, otherwise 200.
// Like Flappy Trusty's, the score comes from the browser, so all this can check is that it adds up.

const MAX_START_LEVEL = 15; // the game's start level picker goes up to the same

// Whole numbers, and the level has to be a start level plus one for every 10 lines, as in the game.
function cleanGame(body) {
    const { score, lines, level } = body || {};
    if (![score, lines, level].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
    const startLevel = level - Math.floor(lines / 10);
    if (startLevel < 1 || startLevel > MAX_START_LEVEL) return null;
    return { score, lines, level };
}

async function getScores(req, res) {
    const db = await connectToDatabase();
    const collection = db.collection('trustis_scores');

    if (req.query.personal) {
        const user = authenticateUser(req);
        if (!user) return res.status(200).json({ highScore: 0 });
        const doc = await collection.findOne({ userId: user.userId }, { projection: { score: 1 } });
        return res.status(200).json({ highScore: doc ? doc.score : 0 });
    }

    const scores = await collection
        .find({}, { projection: { _id: 0, name: 1, score: 1 } })
        .sort({ score: -1, timestamp: 1 })
        .limit(10)
        .toArray();
    return res.status(200).json(scores);
}

async function saveScore(req, res) {
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const game = cleanGame(req.body);
    if (!game) return res.status(400).json({ error: 'Invalid score' });

    const db = await connectToDatabase();
    const collection = db.collection('trustis_scores');
    const saved = { ...game, name: user.username, timestamp: new Date() };

    // Only ever raise a player's best: replace a lower one, or save their first game.
    const raised = await collection.updateOne({ userId: user.userId, score: { $lt: game.score } }, { $set: saved });
    if (raised.matchedCount) return res.status(201).json({ message: 'Score saved!' });
    const first = await collection.updateOne({ userId: user.userId }, { $setOnInsert: saved }, { upsert: true });
    if (first.upsertedCount) return res.status(201).json({ message: 'Score saved!' });
    return res.status(200).json({ message: 'Not a new high score' });
}

export default async function trustis(req, res) {
    try {
        if (req.method === 'GET') return await getScores(req, res);
        if (req.method === 'POST') return await saveScore(req, res);
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Trustis API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
