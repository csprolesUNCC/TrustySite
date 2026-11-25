import { connectToDatabase } from './db.js';
import { authenticateUser, isAdmin } from './auth.js';
import { currentAccount } from './rename.js';
import { dayOf } from '../scripts/milestones.js';
import { cleanEvent, boostFor } from '../scripts/events.js';

// Events and boosts (rules in scripts/events.js), served from api/leaderboard.js as ?action=event so it doesn't
// take up another Vercel function.
//   GET: the event that's on or coming up, { event: { name, text, boosts, times, from, to } | null }. The same for
//     everyone, so Vercel's CDN keeps it for a minute; &fresh=1 skips the CDN (admins load it that way).
//   POST { name, text, boosts, times, from, to }: an admin (ADMINS in utils/auth.js) starts an event, which
//     replaces any other. POST { do: 'end' }: ends it now.
// Every save is kept in the `events` collection and the newest one counts (an ended event is saved as
// { ended: true }), like the Latest Update (utils/update.js).
// boost(key) is what the rewards ask: api/clicks.js (TV, Radio, the daily bonus, Golden Trusties),
// utils/game-rewards.js, api/trustle-api.js, utils/daily.js and utils/quests.js.

const COLLECTION = 'events';
// Each server keeps the newest event this long before asking again, so a reward costs no extra query.
const KEEP_MS = 30 * 1000;

let kept = null; // { event, at }

const shown = (doc) => (doc && !doc.ended ? cleanEvent(doc) : null);

// The newest event, ended or not, as saved (or null).
export async function currentEvent() {
    if (kept && Date.now() - kept.at < KEEP_MS) return kept.event;
    const db = await connectToDatabase();
    const doc = await db.collection(COLLECTION).findOne({}, { sort: { savedAt: -1 } });
    const event = shown(doc);
    kept = { event, at: Date.now() };
    return event;
}

// What reward `key` (BOOSTS in scripts/events.js) is multiplied by right now. A problem reading the event never
// stops a reward: it just isn't boosted.
export async function boost(key) {
    try {
        return boostFor(await currentEvent(), key, dayOf());
    } catch (error) {
        console.error('Event lookup error:', error);
        return 1;
    }
}

async function getEvent(req, res) {
    const event = await currentEvent();
    if (req.query.fresh) {
        res.setHeader('Cache-Control', 'no-store');
    } else {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Vercel-CDN-Cache-Control', 'max-age=60');
    }
    // One that's over isn't news any more.
    return res.status(200).json({ event: event && event.to >= dayOf() ? event : null });
}

async function postEvent(req, res) {
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!isAdmin(user)) return res.status(403).json({ error: 'Admins only' });
    if ((await currentAccount(user)).revoked) return res.status(401).json({ error: 'Authentication required' });

    const db = await connectToDatabase();
    const body = req.body || {};
    if (body.do === 'end') {
        await db.collection(COLLECTION).insertOne({ ended: true, by: user.username, savedAt: new Date() });
        kept = null;
        console.log(`Admin ${user.username}: ended the event`);
        return res.status(200).json({ event: null });
    }
    const event = cleanEvent(body);
    if (!event) return res.status(400).json({ error: 'Give the event a name, pick what it boosts and by how much, and days no more than two weeks apart.' });
    if (event.to < dayOf()) return res.status(400).json({ error: 'That event would already be over.' });
    await db.collection(COLLECTION).insertOne({ ...event, by: user.username, savedAt: new Date() });
    kept = null;
    console.log(`Admin ${user.username}: started the event "${event.name}"`);
    return res.status(200).json({ event });
}

export default async function events(req, res) {
    try {
        if (req.method === 'GET') return await getEvent(req, res);
        if (req.method === 'POST') return await postEvent(req, res);
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Event API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
