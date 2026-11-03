import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { courseNumber, DAILY_TRIES } from '../scripts/flappy-daily.js';

// Daily Flappy's board (pages/games/flappy.html#daily), served from api/leaderboard.js as ?action=flappy-daily
// so it doesn't take up another Vercel function. `flappy_daily` has one document per player per course:
// { day, userId, name, best, bestAt, tries }.
//   GET: today's top 10, [{ name, score }]. GET &day=<n>: an earlier course's (the page shows yesterday's winner).
//   GET &personal=1: { day, best, tries } for the logged-in player today (zeros when logged out).
//   POST { day, score }: a finished flight on today's course. Counts as one of the player's DAILY_TRIES and
//     raises their best; answers { day, best, tries }. 409 when they're out of tries or the course has changed.
// Like the regular Flappy board, the score comes from the browser, so all this can check is that it's believable.

const MAX_SCORE = 100000; // the same as api/flappy-api.js

async function collection() {
    const db = await connectToDatabase();
    return db.collection('flappy_daily');
}

async function getBoard(req, res) {
    const today = courseNumber();
    const col = await collection();

    if (req.query.personal) {
        const user = authenticateUser(req);
        if (!user) return res.status(200).json({ day: today, best: 0, tries: 0 });
        const doc = await col.findOne({ day: today, userId: user.userId }, { projection: { best: 1, tries: 1 } });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ day: today, best: doc ? doc.best : 0, tries: doc ? doc.tries : 0 });
    }

    const asked = req.query.day === undefined ? today : Number(req.query.day);
    if (!Number.isSafeInteger(asked) || asked > today || asked < today - 366) return res.status(400).json({ error: 'Invalid day' });
    const scores = await col
        .find({ day: asked, best: { $gt: 0 } }, { projection: { _id: 0, name: 1, best: 1 } })
        .sort({ best: -1, bestAt: 1 })
        .limit(10)
        .toArray();
    return res.status(200).json(scores.map(({ name, best }) => ({ name, score: best })));
}

async function saveFlight(req, res) {
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const { day, score } = req.body || {};
    if (!Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE || !Number.isSafeInteger(day)) {
        return res.status(400).json({ error: 'Invalid score' });
    }
    const today = courseNumber();
    if (day !== today) return res.status(409).json({ error: 'A new course started at midnight, so that flight was on the old one.', day: today });

    const col = await collection();
    const now = new Date();
    // One more try, if there are any left: count it, and raise the best (and when it was set) if this beat it.
    // Both expressions read the document as it was before this update.
    const counted = await col.findOneAndUpdate(
        { day, userId: user.userId, tries: { $lt: DAILY_TRIES } },
        [{ $set: {
            name: user.username,
            tries: { $add: ['$tries', 1] },
            bestAt: { $cond: [{ $gt: [score, '$best'] }, now, '$bestAt'] },
            best: { $max: ['$best', score] },
        } }],
        { returnDocument: 'after' }
    );
    const doc = counted && 'value' in counted ? counted.value : counted;
    if (doc) return res.status(200).json({ day, best: doc.best, tries: doc.tries });

    // No match: either this is their first flight today, or they've used every try.
    const first = await col.updateOne(
        { day, userId: user.userId },
        { $setOnInsert: { day, userId: user.userId, name: user.username, best: score, bestAt: now, tries: 1 } },
        { upsert: true }
    );
    if (first.upsertedCount) return res.status(200).json({ day, best: score, tries: 1 });
    const done = await col.findOne({ day, userId: user.userId }, { projection: { best: 1, tries: 1 } });
    return res.status(409).json({ error: `That’s all ${DAILY_TRIES} tries for today.`, day, best: done ? done.best : 0, tries: DAILY_TRIES });
}

export default async function flappyDaily(req, res) {
    try {
        if (req.method === 'GET') return await getBoard(req, res);
        if (req.method === 'POST') return await saveFlight(req, res);
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Daily Flappy API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
