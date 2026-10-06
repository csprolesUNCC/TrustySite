import { ObjectId } from 'mongodb';
import { connectToDatabase } from './db.js';
import connectToUsersDatabase from './connect.js';
import { authenticateUser, isAdmin } from './auth.js';
import { badWordsIn } from './bad-words.js';
import { GRADER_VERSION } from '../scripts/draw-grader.js';

// The admin panel (pages/admin.html), served from api/leaderboard.js as ?action=admin so it doesn't take up
// another Vercel function. Only admins (ADMIN_USERNAMES, see utils/auth.js) get anything back.
//   GET: { drawings, users }. `drawings` are the Draw Trusty drawings the site shows (current grader), most
//     reported first, then newest, without the images. `users` is every account's name, newest first, with
//     the ones utils/bad-words.js flags moved to the top. Never returns an email.
//   GET &drawing=<id>: that drawing as a PNG, for the page's <img> tags. Sending every drawing inside the
//     list could go over Vercel's 4.5 MB response limit.
//   POST { remove: <id>, at }: deletes a drawing, and its score with it, from the leaderboard and the profile.
//   POST { dismiss: <id>, at }: clears a drawing's reports once an admin has decided it's fine.
//   A new high score replaces a drawing but keeps its id, so both send `at`, the drawing's time from the list,
//   to make sure they change the drawing the admin saw. If it's been replaced since, they answer 409.

const DRAWING_ID = /^[a-f0-9]{24}$/i;
const PNG_PREFIX = 'data:image/png;base64,';
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

const timeOf = (date) => new Date(date || 0).getTime() || 0;

async function list(res) {
    const db = await connectToDatabase();
    const { db: usersDb } = await connectToUsersDatabase();
    const [drawingDocs, accounts] = await Promise.all([
        db.collection('draw_scores')
            .find({ grader: GRADER_VERSION, drawing: { $type: 'string' } }, { projection: { name: 1, score: 1, timestamp: 1, reportedBy: 1 } })
            .toArray(),
        usersDb.collection('users')
            .find({}, { projection: { username: 1, createdAt: 1 } })
            .sort({ _id: -1 })
            .toArray(),
    ]);

    const drawings = drawingDocs
        .map((doc) => ({
            id: String(doc._id),
            name: doc.name,
            score: doc.score,
            reports: Array.isArray(doc.reportedBy) ? doc.reportedBy.length : 0,
            at: doc.timestamp,
        }))
        .sort((a, b) => b.reports - a.reports || timeOf(b.at) - timeOf(a.at));

    // sort() keeps the newest-first order within the flagged and unflagged names.
    const users = accounts
        .filter((account) => typeof account.username === 'string')
        .map((account) => ({
            username: account.username,
            joined: account.createdAt || account._id.getTimestamp(),
            flags: badWordsIn(account.username),
        }))
        .sort((a, b) => (b.flags.length > 0) - (a.flags.length > 0));

    return res.status(200).json({ drawings, users });
}

async function sendDrawing(req, res) {
    const id = String(req.query.drawing);
    if (!DRAWING_ID.test(id)) return res.status(404).json({ error: 'No such drawing' });

    const db = await connectToDatabase();
    const doc = await db.collection('draw_scores').findOne({ _id: new ObjectId(id) }, { projection: { drawing: 1 } });
    if (!doc || typeof doc.drawing !== 'string' || !PNG_DATA_URL.test(doc.drawing)) {
        return res.status(404).json({ error: 'No such drawing' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The page puts the drawing's timestamp in the link (&v=), so a new drawing gets a new link.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).send(Buffer.from(doc.drawing.slice(PNG_PREFIX.length), 'base64'));
}

async function moderate(req, res) {
    const { remove, dismiss, at } = req.body || {};
    const removing = remove !== undefined;
    const id = removing ? remove : dismiss;
    if (typeof id !== 'string' || !DRAWING_ID.test(id)) return res.status(400).json({ error: 'Invalid drawing' });
    if (at !== null && (typeof at !== 'string' || Number.isNaN(Date.parse(at)))) {
        return res.status(400).json({ error: 'Invalid drawing time' });
    }

    const db = await connectToDatabase();
    const collection = db.collection('draw_scores');
    const _id = new ObjectId(id);
    const seen = { _id, timestamp: at === null ? null : new Date(at) };

    const done = removing
        ? (await collection.deleteOne(seen)).deletedCount
        : (await collection.updateOne(seen, { $unset: { reportedBy: '' } })).matchedCount;
    if (done) return res.status(200).json(removing ? { removed: true } : { reports: 0 });
    if (await collection.countDocuments({ _id })) {
        return res.status(409).json({ error: 'That player just replaced this drawing with a new one. Reload to see it.' });
    }
    return res.status(404).json({ error: 'That drawing is already gone.' });
}

export default async function admin(req, res) {
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!isAdmin(user)) return res.status(403).json({ error: 'Admins only' });

    try {
        if (req.method === 'GET' && req.query.drawing) return await sendDrawing(req, res);
        if (req.method === 'GET') return await list(res);
        if (req.method === 'POST') return await moderate(req, res);
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Admin API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
