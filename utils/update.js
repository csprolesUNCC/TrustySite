import { connectToDatabase } from './db.js';
import { authenticateUser, isAdmin } from './auth.js';
import { cleanText } from './text.js';

// The Latest Update note on the home page (index.html), served from api/leaderboard.js as ?action=update so
// it doesn't take up another Vercel function.
//   GET: the update, { date, headline, text }. It's the same for everyone, so Vercel's CDN keeps it for a
//     minute; &fresh=1 skips the CDN (admins load it that way, so they see their own changes right away).
//   POST { date, headline, text }: an admin (ADMINS in utils/auth.js) posts a new update. Answers with it,
//     cleaned up the way it was saved.
// Every update is kept in the `updates` collection and the newest one is shown, so one that gets replaced by
// mistake can still be found in the database. Until an admin posts one, the note shows DEFAULT.

// The longest headline and update; the form on the home page allows the same.
const HEADLINE_MAX = 60;
const TEXT_MAX = 400;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// What the note said back when it was written into index.html.
const DEFAULT = {
    date: '2026-09-27',
    headline: 'Full Revamp!',
    text: "Trusty's site has been given a full makeover! Explore all the classic games you remember, polished and shiny for your enjoyment. Alternatively, you can sit back and enjoy the various channels on Trusty TV!",
};

// A real day on the calendar, written the way <input type="date"> sends it (YYYY-MM-DD).
function cleanDate(value) {
    if (typeof value !== 'string' || !DAY.test(value)) return null;
    const day = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value ? value : null;
}

async function getUpdate(req, res) {
    const db = await connectToDatabase();
    const latest = await db.collection('updates').findOne(
        {},
        { sort: { savedAt: -1 }, projection: { _id: 0, date: 1, headline: 1, text: 1 } }
    );
    if (req.query.fresh) {
        res.setHeader('Cache-Control', 'no-store');
    } else {
        // Browsers ask every time (the home page shows the copy it kept meanwhile) and the CDN answers them.
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Vercel-CDN-Cache-Control', 'max-age=60');
    }
    return res.status(200).json(latest || DEFAULT);
}

async function postUpdate(req, res) {
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!isAdmin(user)) return res.status(403).json({ error: 'Admins only' });

    const { date, headline = '', text } = req.body || {};
    if (typeof headline !== 'string' || typeof text !== 'string' || headline.length > HEADLINE_MAX * 10 || text.length > TEXT_MAX * 10) {
        return res.status(400).json({ error: 'Invalid update' });
    }
    // The headline is one line of bold text; the update itself can have line breaks.
    const update = { date: cleanDate(date), headline: cleanText(headline).replace(/\s+/g, ' '), text: cleanText(text) };
    if (!update.date) return res.status(400).json({ error: 'Pick a date for the update.' });
    if (!update.text) return res.status(400).json({ error: 'Write something for the update.' });
    if (update.headline.length > HEADLINE_MAX) return res.status(400).json({ error: `Keep the headline to ${HEADLINE_MAX} characters.` });
    if (update.text.length > TEXT_MAX) return res.status(400).json({ error: `Keep the update to ${TEXT_MAX} characters.` });

    const db = await connectToDatabase();
    await db.collection('updates').insertOne({ ...update, by: user.username, savedAt: new Date() });
    console.log(`Admin ${user.username}: posted the Latest Update`);
    return res.status(200).json(update);
}

export default async function latestUpdate(req, res) {
    try {
        if (req.method === 'GET') return await getUpdate(req, res);
        if (req.method === 'POST') return await postUpdate(req, res);
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Update API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
