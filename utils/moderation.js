import { ObjectId } from 'mongodb';
import { connectToDatabase } from './db.js';
import connectToUsersDatabase from './connect.js';
import { authenticateUser, isAdmin } from './auth.js';
import { badWordsIn } from './bad-words.js';
import { GRADER_VERSION } from '../scripts/draw-grader.js';

// Reporting Draw Trusty drawings, and the admin panel (pages/admin.html). Both are served from existing
// functions so they don't take up more Vercel functions:
//   POST /api/draw-api?action=report { id, at }: a logged-in player reports someone else's drawing, once.
//   /api/leaderboard?action=admin, for admins only (ADMINS in utils/auth.js):
//     GET &view=drawings: the drawings on the site, most reported first, without the images.
//     GET &view=drawing&id=&at=: one drawing as a PNG, so the list doesn't have to carry every image.
//     GET &view=users: every username, newest first, with any bad words in it (utils/bad-words.js).
//     POST { do: 'remove' | 'dismiss', id, at }: delete a drawing along with its score, or clear its reports.
// Reports live on the drawing's document in `draw_scores`: `reportedBy` lists everyone who reported it (so
// nobody can report it twice) and `reports` counts the ones an admin hasn't cleared yet. A new high score
// replaces the drawing and starts both over (api/draw-api.js).

const PNG_PREFIX = 'data:image/png;base64,';
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const MAX_DRAWINGS = 500;
const MAX_USERS = 5000;

// Only drawings from the current grader are shown anywhere on the site, so those are the ones to check.
const CURRENT = { grader: GRADER_VERSION };

// The drawing a page showed: its id plus when it was saved (`at`). A new high score keeps the id but
// swaps the drawing, so checking both means a report or removal never lands on a drawing nobody saw.
function drawingRef(source) {
    const { id, at } = source || {};
    if (typeof id !== 'string' || !OBJECT_ID.test(id) || typeof at !== 'string') return null;
    const timestamp = new Date(at);
    if (Number.isNaN(timestamp.getTime())) return null;
    return { _id: new ObjectId(id), timestamp, ...CURRENT };
}

export async function reportDrawing(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Log in to report drawings.' });
    const ref = drawingRef(req.body);
    if (!ref) return res.status(400).json({ error: 'Invalid drawing' });

    try {
        const db = await connectToDatabase();
        const drawings = db.collection('draw_scores');
        const me = String(user.userId);
        const reported = await drawings.updateOne(
            { ...ref, userId: { $ne: me }, reportedBy: { $ne: me } },
            { $push: { reportedBy: me }, $inc: { reports: 1 } }
        );
        if (reported.matchedCount) return res.status(201).json({ message: 'Reported' });

        // Nothing changed: the drawing is gone or was replaced, it's yours, or you already reported it.
        const drawing = await drawings.findOne(ref, { projection: { userId: 1 } });
        if (!drawing) return res.status(404).json({ error: 'That drawing has been replaced or taken down.' });
        if (String(drawing.userId) === me) return res.status(400).json({ error: 'You can’t report your own drawing.' });
        return res.status(200).json({ message: 'Already reported' });
    } catch (error) {
        console.error('Report API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function listDrawings(res) {
    const db = await connectToDatabase();
    const drawings = db.collection('draw_scores');
    const [list, total] = await Promise.all([
        drawings.aggregate([
            { $match: CURRENT },
            { $project: { name: 1, score: 1, timestamp: 1, reports: { $ifNull: ['$reports', 0] } } },
            { $sort: { reports: -1, timestamp: -1 } },
            { $limit: MAX_DRAWINGS },
        ]).toArray(),
        drawings.countDocuments(CURRENT),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
        total,
        drawings: list.map((d) => ({ id: String(d._id), name: d.name, score: d.score, at: d.timestamp, reports: d.reports })),
    });
}

async function sendDrawing(req, res) {
    const ref = drawingRef(req.query);
    if (!ref) return res.status(400).json({ error: 'Invalid drawing' });
    const db = await connectToDatabase();
    const drawing = await db.collection('draw_scores').findOne(ref, { projection: { drawing: 1 } });
    if (!drawing || typeof drawing.drawing !== 'string' || !PNG_DATA_URL.test(drawing.drawing)) {
        return res.status(404).json({ error: 'No such drawing' });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // An id and `at` always mean the same picture, so the browser can keep it.
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    return res.status(200).send(Buffer.from(drawing.drawing.slice(PNG_PREFIX.length), 'base64'));
}

async function listUsers(res) {
    const { db } = await connectToUsersDatabase();
    const accounts = db.collection('users');
    const [list, total] = await Promise.all([
        accounts.find({}, { projection: { username: 1, createdAt: 1 } }).sort({ _id: -1 }).limit(MAX_USERS).toArray(),
        accounts.countDocuments({}),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
        total,
        users: list.map((account) => {
            const name = typeof account.username === 'string' ? account.username : '';
            return { name, joined: account.createdAt || account._id.getTimestamp(), flags: badWordsIn(name) };
        }),
    });
}

async function moderate(req, res, admin) {
    const body = req.body || {};
    const ref = drawingRef(body);
    if (!ref || (body.do !== 'remove' && body.do !== 'dismiss')) return res.status(400).json({ error: 'Invalid request' });

    const db = await connectToDatabase();
    const drawings = db.collection('draw_scores');
    const done = body.do === 'remove'
        ? (await drawings.deleteOne(ref)).deletedCount
        : (await drawings.updateOne(ref, { $set: { reports: 0 } })).matchedCount;
    if (!done) {
        return res.status(409).json({ error: 'That drawing was replaced or taken down since the page loaded.' });
    }
    console.log(`Admin ${admin.username}: ${body.do} drawing ${body.id}`);
    return res.status(200).json({ ok: true });
}

export default async function adminApi(req, res) {
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!isAdmin(user)) return res.status(403).json({ error: 'Admins only' });

    try {
        const { view } = req.query;
        if (req.method === 'GET' && view === 'drawings') return await listDrawings(res);
        if (req.method === 'GET' && view === 'drawing') return await sendDrawing(req, res);
        if (req.method === 'GET' && view === 'users') return await listUsers(res);
        if (req.method === 'POST') return await moderate(req, res, user);
        return res.status(400).json({ error: 'Invalid request' });
    } catch (error) {
        console.error('Admin API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
