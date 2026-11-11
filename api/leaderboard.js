import { connectToDatabase } from '../utils/db.js';
import profile from '../utils/profile.js';
import trustis from '../utils/trustis.js';
import adminApi from '../utils/moderation.js';
import latestUpdate from '../utils/update.js';
import rename from '../utils/rename.js';
import feverOnline from '../utils/fever-online.js';
import bank from '../utils/bank.js';
import soloBlackjack from '../utils/solo-blackjack.js';

export default async (req, res) => {
    // Profile pages (?action=profile, see utils/profile.js), changing your username (?action=rename, see
    // utils/rename.js), the Trustis board (?action=trustis, see utils/trustis.js), the admin panel
    // (?action=admin, see utils/moderation.js), the home page's Latest Update (?action=update, see
    // utils/update.js), tickets into the online rooms (?action=fever, see utils/fever-online.js), the click
    // bank for betting clicks there (?action=bank, see utils/bank.js) and Trusty Blackjack for one player
    // (?action=blackjack, see utils/solo-blackjack.js) live here too to save Vercel functions.
    if (req.query.action === 'profile') {
        return profile(req, res);
    }
    if (req.query.action === 'rename') {
        return rename(req, res);
    }
    if (req.query.action === 'trustis') {
        return trustis(req, res);
    }
    if (req.query.action === 'admin') {
        return adminApi(req, res);
    }
    if (req.query.action === 'update') {
        return latestUpdate(req, res);
    }
    if (req.query.action === 'fever') {
        return feverOnline(req, res);
    }
    if (req.query.action === 'bank') {
        return bank(req, res);
    }
    if (req.query.action === 'blackjack') {
        return soloBlackjack(req, res);
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const db = await connectToDatabase();
        const collection = db.collection('click_game');

        // The page shows the top 50 (MAX_ROWS in pages/leaderboard.html); profiles work out ranks on their own.
        const leaderboard = await collection
            .find({ clicks: { $gt: 0 } }, { projection: { _id: 0, username: 1, clicks: 1 } })
            .sort({ clicks: -1 })
            .limit(50)
            .toArray();

        return res.status(200).json(leaderboard);
    } catch (error) {
        console.error('Leaderboard API Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
