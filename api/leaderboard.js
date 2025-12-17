import { connectToDatabase } from './db.js';

export default async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const db = await connectToDatabase();
        const collection = db.collection('click_game');

        const leaderboard = await collection
            .find({})
            .sort({ clicks: -1 })
            .toArray();

        return res.status(200).json(leaderboard);
    } catch (error) {
        console.error('Leaderboard API Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};