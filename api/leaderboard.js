import { connectToDatabase } from '../utils/db.js';
import { cachePublic } from '../utils/cache.js';
import profile from '../utils/profile.js';
import trustis from '../utils/trustis.js';
import snake from '../utils/snake.js';
import adminApi from '../utils/moderation.js';
import latestUpdate from '../utils/update.js';
import rename from '../utils/rename.js';
import feverOnline from '../utils/fever-online.js';
import bank from '../utils/bank.js';
import soloBlackjack from '../utils/solo-blackjack.js';
import soloCraps from '../utils/solo-craps.js';
import soloSlots from '../utils/solo-slots.js';
import soloPoker from '../utils/solo-poker.js';
import daily from '../utils/daily.js';
import shop from '../utils/shop.js';
import events from '../utils/events.js';
import quests from '../utils/quests.js';
import weekly from '../utils/weekly.js';
import transfer from '../utils/transfer.js';
import notifications from '../utils/notifications.js';

export default async (req, res) => {
    // Profile pages (?action=profile, see utils/profile.js), changing your username (?action=rename, see
    // utils/rename.js), the Trustis board (?action=trustis, see utils/trustis.js), the Trusty Snake board
    // (?action=snake, see utils/snake.js), the admin panel (?action=admin, see utils/moderation.js), the home page's Latest Update (?action=update, see
    // utils/update.js), tickets into the online rooms (?action=fever, see utils/fever-online.js), the click
    // bank for betting clicks there (?action=bank, see utils/bank.js), Trusty Blackjack for one player
    // (?action=blackjack, see utils/solo-blackjack.js), Trusty Craps (?action=craps, see utils/solo-craps.js),
    // Trusty Slots (?action=slots, see utils/solo-slots.js) and Trusty Poker against the bots (?action=poker, see
    // utils/solo-poker.js), the Daily Games board (?action=daily, see utils/daily.js) and the Item Shop
    // (?action=shop, see utils/shop.js), events and boosts (?action=event, see utils/events.js) and Daily Quests
    // (?action=quests, see utils/quests.js), the weekly leaderboards (?action=weekly, see utils/weekly.js) and
    // sending clicks to another player (?action=transfer, see utils/transfer.js) and the header's notifications
    // (?action=notifications, see utils/notifications.js) live here too to save Vercel functions.
    if (req.query.action === 'profile') {
        return profile(req, res);
    }
    if (req.query.action === 'rename') {
        return rename(req, res);
    }
    if (req.query.action === 'trustis') {
        return trustis(req, res);
    }
    if (req.query.action === 'snake') {
        return snake(req, res);
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
    if (req.query.action === 'craps') {
        return soloCraps(req, res);
    }
    if (req.query.action === 'slots') {
        return soloSlots(req, res);
    }
    if (req.query.action === 'poker') {
        return soloPoker(req, res);
    }
    if (req.query.action === 'daily') {
        return daily(req, res);
    }
    if (req.query.action === 'shop') {
        return shop(req, res);
    }
    if (req.query.action === 'event') {
        return events(req, res);
    }
    if (req.query.action === 'quests') {
        return quests(req, res);
    }
    if (req.query.action === 'weekly') {
        return weekly(req, res);
    }
    if (req.query.action === 'transfer') {
        return transfer(req, res);
    }
    if (req.query.action === 'notifications') {
        return notifications(req, res);
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

        cachePublic(req, res);
        return res.status(200).json(leaderboard);
    } catch (error) {
        console.error('Leaderboard API Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
