import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { cachePublic } from './cache.js';
import { rewardGame } from './game-rewards.js';

// The Trusty Snake leaderboard (pages/games/snake.html), served from api/leaderboard.js as ?action=snake so it
// doesn't take up another Vercel function. `snake_scores` keeps each player's best game.
//   GET: the top 10, [{ name, score }].
//   GET &personal=1: the logged-in player's best, { highScore } (0 when logged out).
//   POST { score }: a finished game. Saved (201) if it beats the player's best, otherwise 200.
//     Either way it pays the game's clicks: `reward` is { added, clicks, today, cap }, or null if that failed.
// Like Flappy Trusty's, the score comes from the browser, so all this can check is that it could happen.

// The board is 15x15 squares and Trusty starts 3 long, so filling the whole page is 222 snacks (the game's
// SIZE / CELL squares, less its starting length).
const MAX_SCORE = 15 * 15 - 3;

function cleanGame(body) {
    const { score } = body || {};
    if (!Number.isSafeInteger(score) || score < 1 || score > MAX_SCORE) return null;
    return { score };
}

async function getScores(req, res) {
    const db = await connectToDatabase();
    const collection = db.collection('snake_scores');

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
    cachePublic(req, res);
    return res.status(200).json(scores);
}

async function saveScore(req, res) {
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const game = cleanGame(req.body);
    if (!game) return res.status(400).json({ error: 'Invalid score' });

    const db = await connectToDatabase();
    const collection = db.collection('snake_scores');
    const saved = { ...game, name: user.username, timestamp: new Date() };
    // Every finished game earns clicks (utils/game-rewards.js), best or not.
    const reward = await rewardGame(user, 'snake', game.score);

    // Only ever raise a player's best: replace a lower one, or save their first game.
    const raised = await collection.updateOne({ userId: user.userId, score: { $lt: game.score } }, { $set: saved });
    if (raised.matchedCount) return res.status(201).json({ message: 'Score saved!', reward });
    const first = await collection.updateOne({ userId: user.userId }, { $setOnInsert: saved }, { upsert: true });
    if (first.upsertedCount) return res.status(201).json({ message: 'Score saved!', reward });
    return res.status(200).json({ message: 'Not a new high score', reward });
}

export default async function snake(req, res) {
    try {
        if (req.method === 'GET') return await getScores(req, res);
        if (req.method === 'POST') return await saveScore(req, res);
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Snake API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
