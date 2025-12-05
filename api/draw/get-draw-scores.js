import { connectToDatabase } from '../db.js';

export default async (req, res) => {
    try {
        const db = await connectToDatabase();
        const collection = db.collection('draw_scores');

        const scores = await collection
            .find({})
            .project({ name: 1, score: 1, _id: 0 }) 
            .sort({ score: -1, timestamp: 1 }) 
            .limit(10)
            .toArray();

        res.status(200).json(scores);
    } catch (error) {
        console.error("Error fetching draw scores:", error);
        res.status(500).json({ error: 'Failed to fetch scores' });
    }
};