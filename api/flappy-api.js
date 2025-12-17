import { connectToDatabase } from './connect.js';
import { authenticateUser } from '../utils/auth.js';

export default async (req, res) => {
    const { method } = req;
    const { action } = req.query;

    try {
        const { db } = await connectToDatabase();
        const collection = db.collection('flappy-scores');

        // --- 1. SUBMIT SCORE (POST) ---
        if (method === 'POST') {
            const user = authenticateUser(req);
            if (!user) return res.status(401).json({ error: 'Auth required' });

            const { score } = req.body;
            if (typeof score !== 'number' || score < 0) {
                return res.status(400).json({ error: 'Invalid score' });
            }

            const existingScore = await collection.findOne({ userId: user.userId });

            if (existingScore && score <= existingScore.score) {
                return res.status(200).json({ message: 'Not a new high score' });
            }

            await collection.updateOne(
                { userId: user.userId },
                { $set: { userId: user.userId, name: user.username, score, timestamp: new Date() } },
                { upsert: true }
            );
            return res.status(201).json({ message: 'Score updated!' });
        }

        // --- 2. GET HIGH SCORE OR LEADERBOARD (GET) ---
        if (method === 'GET') {
            // Action: Fetch personal high score
            if (action === 'personal') {
                const user = authenticateUser(req);
                if (!user) return res.status(200).json({ highScore: 0 });

                const personalHighScore = await collection.findOne({ userId: user.userId });
                return res.status(200).json({ highScore: personalHighScore ? personalHighScore.score : 0 });
            }

            // Default Action: Fetch Global Leaderboard
            const scores = await collection
                .find({})
                .project({ name: 1, score: 1, _id: 0 })
                .sort({ score: -1, timestamp: 1 })
                .limit(10)
                .toArray();

            return res.status(200).json(scores);
        }

        return res.status(405).send('Method Not Allowed');
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};