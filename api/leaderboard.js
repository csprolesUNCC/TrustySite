import { connectToDatabase } from '../utils/db.js';
import profile from '../utils/profile.js';

export default async (req, res) => {
    // Profile pages live here too (?action=profile, see utils/profile.js) to save a Vercel function.
    if (req.query.action === 'profile') {
        return profile(req, res);
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const db = await connectToDatabase();
        const collection = db.collection('click_game');

        const leaderboard = await collection
            .find({}, { projection: { _id: 0, username: 1, clicks: 1 } })
            .sort({ clicks: -1 })
            .toArray();

        return res.status(200).json(leaderboard);
    } catch (error) {
        console.error('Leaderboard API Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
