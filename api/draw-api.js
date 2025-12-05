import { connectToDatabase } from './db.js';
import { authenticateUser } from '../utils/auth.js';

export default async (req, res) => {
    const { action } = req.query;
    try {
        const db = await connectToDatabase();
        const collection = db.collection('draw_scores');

        // --- HANDLER 1: GET LEADERBOARD ---
        if (req.method === 'GET' && action === 'get_leaderboard') {
            const scores = await collection
                .find({})
                .project({ name: 1, score: 1, _id: 0 })
                .sort({ score: -1, timestamp: 1 })
                .limit(10)
                .toArray();
            return res.status(200).json(scores);
        }

        // --- HANDLER 2: GET USER HIGH SCORE ---
        if (req.method === 'GET' && action === 'get_personal') {
            const user = authenticateUser(req);
            if (!user) return res.status(200).json({ highScore: 0 });

            const personalHighScore = await collection.findOne(
                { userId: user.userId },
                { sort: { score: -1 } }
            );
            return res.status(200).json({ highScore: personalHighScore ? personalHighScore.score : 0 });
        }

        // --- HANDLER 3: SUBMIT SCORE ---
        if (req.method === 'POST' && action === 'submit') {
            const user = authenticateUser(req);
            if (!user) return res.status(401).json({ error: 'Auth required' });

            const { score } = req.body;
            if (typeof score !== 'number' || score < 0) {
                return res.status(400).json({ error: 'Invalid score' });
            }

            const existingScore = await collection.findOne(
                { userId: user.userId },
                { sort: { score: -1 } }
            );

            if (existingScore && score <= existingScore.score) {
                return res.status(200).json({ message: 'Not a new high score' });
            }

            await collection.updateOne(
                { userId: user.userId },
                { 
                    $set: { 
                        userId: user.userId, 
                        name: user.username, 
                        score: score, 
                        timestamp: new Date() 
                    } 
                },
                { upsert: true }
            );
            return res.status(201).json({ message: 'Score saved!' });
        }

        return res.status(400).json({ error: 'Invalid action or method' });

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};