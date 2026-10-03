import { connectToDatabase } from './db.js';
import connectToUsersDatabase from './connect.js';
import { authenticateUser } from './auth.js';
import { GRADER_VERSION } from '../scripts/draw-grader.js';
import { puzzleNumber, cleanGame, statsFrom } from '../scripts/trustle.js';
import { CHANNELS } from '../scripts/tv-lineup.js';

// Profile pages (pages/profile.html), served from api/leaderboard.js as ?action=profile so they don't
// take up another Vercel function.
//   GET ?u=<username>: anyone can see a profile. The stats come from the game data the site already
//     keeps; only the bio is written by the user. Never returns an email.
//   POST { bio }: saves the logged-in user's own bio (in the `profiles` collection of the game db).

const BIO_MAX = 300; // pages/profile.html allows the same

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const CASE_INSENSITIVE = { locale: 'en', strength: 2 }; // the same collation register.js checks names with

// Plain text only: no control characters or text-direction tricks, Unix line breaks, no spaces at the
// ends of lines, and at most one blank line in a row.
function cleanBio(text) {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/(?!\n)[\p{Cc}\p{Bidi_Control}]/gu, '')
        .replace(/[^\S\n]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Your place on a board sorted by `field` (high first). Boards that break ties put earlier scores first
// (`ties: true`, needs a timestamp); the clicker board doesn't break them.
async function rankOf(collection, field, doc, { filter = {}, ties = false } = {}) {
    const ahead = [{ [field]: { $gt: doc[field] } }];
    if (ties && doc.timestamp) ahead.push({ [field]: doc[field], timestamp: { $lt: doc.timestamp } });
    return 1 + await collection.countDocuments({ ...filter, $or: ahead });
}

async function getProfile(req, res) {
    const name = typeof req.query.u === 'string' ? req.query.u.trim() : '';
    if (!name || name.length > 100) return res.status(404).json({ error: 'No one by that name' });

    const { db: usersDb } = await connectToUsersDatabase();
    const account = await usersDb.collection('users').findOne(
        { username: name },
        { collation: CASE_INSENSITIVE, projection: { username: 1, createdAt: 1 } }
    );
    if (!account) return res.status(404).json({ error: 'No one by that name' });

    const userId = String(account._id);
    const db = await connectToDatabase();
    const clicksCol = db.collection('click_game');
    const flappyCol = db.collection('scores');
    const drawCol = db.collection('draw_scores');
    const best = { sort: { score: -1, timestamp: 1 } };
    const [clickDoc, flappyDoc, drawDoc, trustleDoc, profileDoc] = await Promise.all([
        clicksCol.findOne({ userId }, { projection: { clicks: 1, tvSeconds: 1 } }),
        flappyCol.findOne({ userId }, { ...best, projection: { score: 1, timestamp: 1 } }),
        drawCol.findOne({ userId, grader: GRADER_VERSION }, { ...best, projection: { score: 1, timestamp: 1, drawing: 1 } }),
        db.collection('trustle').findOne({ userId }, { projection: { games: 1 } }),
        db.collection('profiles').findOne({ userId }, { projection: { bio: 1 } }),
    ]);

    const hasClicks = clickDoc && clickDoc.clicks > 0;
    const hasFlappy = flappyDoc && typeof flappyDoc.score === 'number';
    const hasDraw = drawDoc && typeof drawDoc.score === 'number';
    const [clickRank, flappyRank, drawRank] = await Promise.all([
        hasClicks ? rankOf(clicksCol, 'clicks', clickDoc) : null,
        hasFlappy ? rankOf(flappyCol, 'score', flappyDoc, { ties: true }) : null,
        hasDraw ? rankOf(drawCol, 'score', drawDoc, { filter: { grader: GRADER_VERSION }, ties: true }) : null,
    ]);

    // Trustle stats are worked out from the synced history, the same way the game page does it.
    const history = {};
    for (const [key, game] of Object.entries((trustleDoc && trustleDoc.games) || {})) {
        const n = Number(key);
        const clean = cleanGame(n, game);
        if (clean) history[n] = clean;
    }
    const trustle = statsFrom(history, puzzleNumber());

    // Seconds of Trusty TV watched on each channel (api/clicks.js adds them up).
    const tv = {};
    const watched = (clickDoc && clickDoc.tvSeconds) || {};
    for (const { key } of CHANNELS) {
        if (Number(watched[key]) > 0) tv[key] = Number(watched[key]);
    }

    const me = authenticateUser(req);
    return res.status(200).json({
        username: account.username,
        memberSince: account.createdAt || account._id.getTimestamp(),
        isMe: Boolean(me && String(me.userId) === userId),
        bio: profileDoc && typeof profileDoc.bio === 'string' ? profileDoc.bio : '',
        clicks: hasClicks ? { total: clickDoc.clicks, rank: clickRank } : null,
        flappy: hasFlappy ? { score: flappyDoc.score, rank: flappyRank } : null,
        draw: hasDraw ? {
            score: drawDoc.score,
            rank: drawRank,
            drawing: typeof drawDoc.drawing === 'string' && PNG_DATA_URL.test(drawDoc.drawing) ? drawDoc.drawing : null,
        } : null,
        trustle: trustle.played ? trustle : null,
        tv,
    });
}

async function saveBio(req, res) {
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const sent = req.body && req.body.bio;
    if (typeof sent !== 'string' || sent.length > BIO_MAX * 10) return res.status(400).json({ error: 'Invalid bio' });
    const bio = cleanBio(sent);
    if (bio.length > BIO_MAX) return res.status(400).json({ error: `Keep your bio to ${BIO_MAX} characters.` });

    const db = await connectToDatabase();
    await db.collection('profiles').updateOne(
        { userId: user.userId },
        { $set: { userId: user.userId, username: user.username, bio, updatedAt: new Date() } },
        { upsert: true }
    );
    return res.status(200).json({ bio });
}

export default async function profile(req, res) {
    try {
        if (req.method === 'GET') return await getProfile(req, res);
        if (req.method === 'POST') return await saveBio(req, res);
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Profile API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
