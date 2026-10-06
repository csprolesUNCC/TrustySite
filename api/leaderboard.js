import { connectToDatabase } from '../utils/db.js';
import profile from '../utils/profile.js';
import trustis from '../utils/trustis.js';
import admin from '../utils/admin.js';

export default async (req, res) => {
    // Profile pages (?action=profile, see utils/profile.js), the Trustis board (?action=trustis, see
    // utils/trustis.js) and the admin panel (?action=admin, see utils/admin.js) live here too to save
    // Vercel functions.
    if (req.query.action === 'profile') {
        return profile(req, res);
    }
    if (req.query.action === 'trustis') {
        return trustis(req, res);
    }
    if (req.query.action === 'admin') {
        return admin(req, res);
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
