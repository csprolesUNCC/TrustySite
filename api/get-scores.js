// api/get-scores.js
import { connectToDatabase } from './db.js';

export default async (req, res) => {
    try {
        const db = await connectToDatabase();
        const collection = db.collection('scores');

        // Fetch top 10 scores, sorted by score descending
        // Because submit-score now uses upsert by userId, this naturally gets the highest unique scores.
        const scores = await collection
            .find({})
            // Ensure fields shown are name and score (exclude the sensitive userId)
            .project({ name: 1, score: 1, _id: 0 }) 
            .sort({ score: -1, timestamp: 1 }) 
            .limit(10)
            .toArray();

        res.status(200).json(scores);
    } catch (error) {
        console.error("Error fetching scores:", error);
        res.status(500).json({ error: 'Failed to fetch scores' });
    }
};