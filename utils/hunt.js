import { connectToDatabase } from './db.js';
import { authenticateUser, isAdmin } from './auth.js';
import { currentAccount } from './rename.js';
import { clientIp } from './rate-limit.js';
import { mongoHunt } from './hunt-store.js';
import { handle } from './hunt-game.js';

// The real-world hunt (utils/hunt-game.js says what each request does), served from api/leaderboard.js as
// ?action=hunt so it doesn't take up another Vercel function.

let store = null;

export default async function hunt(req, res) {
    try {
        const db = await connectToDatabase();
        store ||= mongoHunt(db);
        const user = authenticateUser(req);
        // Admin actions also check the login hasn't been revoked by a password reset.
        const admin = Boolean(user && isAdmin(user) && !(await currentAccount(user)).revoked);
        const [status, body, cache] = await handle(store, {
            method: req.method, query: req.query || {}, body: req.body, user, admin, ip: clientIp(req), now: Date.now(),
        });
        if (cache === 'public') {
            // The same for everyone that minute (Trusty TV's intermissions): the CDN answers most viewers.
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Vercel-CDN-Cache-Control', 'max-age=60');
        } else {
            res.setHeader('Cache-Control', 'no-store');
        }
        return res.status(status).json(body);
    } catch (error) {
        console.error('Hunt API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
