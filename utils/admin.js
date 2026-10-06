import { connectToDatabase } from './db.js';
import connectToUsersDatabase from './connect.js';
import { authenticateUser, isAdmin } from './auth.js';
import { PNG_DATA_URL, drawingKey, drawingFilter } from './drawings.js';
import { flagWords } from './bad-words.js';
import { GRADER_VERSION } from '../scripts/draw-grader.js';

// The admin panel (pages/admin.html), served from api/leaderboard.js as ?action=admin so it doesn't take up
// another Vercel function. Only the admins listed in utils/auth.js get past the check at the bottom.
//   GET &view=drawings: the Draw Trusty drawings the site shows (current grader), most reported first, then
//     newest. Without the pictures: a list of data URLs could pass Vercel's 4.5 MB response limit.
//   GET &view=image&id=…: one drawing's picture as a PNG, for the page's <img>s.
//   GET &view=usernames: every username, with the bad words in it (utils/bad-words.js). Never returns emails.
//   POST { op, id, at } (see utils/drawings.js): 'remove' takes a drawing down, score and all, keeping a copy in
//     `removed_drawings` in case it was a mistake; 'dismiss' clears its reports when it's fine. Either answers
//     409 if the drawing changed or went away since the page loaded.

const MAX_DRAWINGS = 1000;
const PNG_PREFIX = 'data:image/png;base64,';

const reportCount = (doc) => (Number(doc.reports) > 0 ? Number(doc.reports) : 0);
const time = (doc) => (doc.timestamp instanceof Date ? doc.timestamp.getTime() : 0);

async function listDrawings(res) {
    const db = await connectToDatabase();
    const docs = await db.collection('draw_scores')
        .find({ grader: GRADER_VERSION }, { projection: { name: 1, score: 1, timestamp: 1, reports: 1 } })
        .sort({ reports: -1, timestamp: -1 })
        .limit(MAX_DRAWINGS)
        .toArray();
    // Older drawings have no `reports` at all, which the database sorts apart from 0, so sort again here.
    docs.sort((a, b) => reportCount(b) - reportCount(a) || time(b) - time(a));
    return res.status(200).json({
        drawings: docs.map((doc) => {
            const { id, at } = drawingKey(doc);
            return { id, at, name: typeof doc.name === 'string' ? doc.name : '', score: Number(doc.score) || 0, reports: reportCount(doc) };
        }),
    });
}

async function sendImage(req, res) {
    const drawing = drawingFilter({ id: req.query.id });
    if (!drawing) return res.status(404).end();
    const db = await connectToDatabase();
    const doc = await db.collection('draw_scores').findOne(drawing, { projection: { drawing: 1 } });
    if (!doc || typeof doc.drawing !== 'string' || !PNG_DATA_URL.test(doc.drawing)) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The page puts the drawing's timestamp in the address, so a newer drawing never comes from the cache.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).send(Buffer.from(doc.drawing.slice(PNG_PREFIX.length), 'base64'));
}

async function listUsernames(res) {
    const { db } = await connectToUsersDatabase();
    const accounts = await db.collection('users')
        .find({}, { projection: { username: 1, createdAt: 1 } })
        .toArray();
    const users = accounts
        .filter((account) => typeof account.username === 'string' && account.username)
        .map((account) => ({
            username: account.username,
            joined: account.createdAt || account._id.getTimestamp(),
            flags: flagWords(account.username),
        }));
    return res.status(200).json({ users });
}

async function moderate(req, res, admin) {
    const op = req.body && req.body.op;
    const drawing = drawingFilter(req.body);
    if (!drawing || (op !== 'remove' && op !== 'dismiss')) return res.status(400).json({ error: 'Invalid request' });

    const db = await connectToDatabase();
    const collection = db.collection('draw_scores');
    const changed = () => res.status(409).json({ error: 'That drawing changed or was already removed. Reload to see what’s there now.' });

    if (op === 'dismiss') {
        const cleared = await collection.updateOne(drawing, { $set: { reports: 0 } });
        return cleared.matchedCount ? res.status(200).json({ reports: 0 }) : changed();
    }

    const result = await collection.findOneAndDelete(drawing);
    const doc = result && 'value' in result ? result.value : result;
    if (!doc) return changed();
    const { _id, ...removed } = doc;
    try {
        await db.collection('removed_drawings').insertOne({ ...removed, drawingId: _id, removedBy: admin.username, removedAt: new Date() });
    } catch (error) {
        console.error('Admin API: couldn’t keep a copy of a removed drawing:', error);
    }
    return res.status(200).json({ removed: true });
}

export default async function admin(req, res) {
    try {
        const user = authenticateUser(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!isAdmin(user)) return res.status(403).json({ error: 'Admins only' });

        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
            const { view } = req.query;
            if (view === 'drawings') return await listDrawings(res);
            if (view === 'image') return await sendImage(req, res);
            if (view === 'usernames') return await listUsernames(res);
            return res.status(400).json({ error: 'Unknown view' });
        }
        if (req.method === 'POST') return await moderate(req, res, user);
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Admin API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
