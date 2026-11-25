import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { boost } from './events.js';
import { dayOf } from '../scripts/milestones.js';
import { puzzleNumber } from '../scripts/trustle.js';
import { QUEST_REWARD, ALL_BONUS, factsOf, paidToday, questStatus, toClaim } from '../scripts/quests.js';

// Daily Quests (rules in scripts/quests.js), served from api/leaderboard.js as ?action=quests so they don't take up
// another Vercel function. Logged in only.
//   GET: today's quests and how far along you are: { day, quests: [{ id, kind, at, text, href, count, complete,
//     paid }], reward, bonus, bonusPaid, times } (`reward` and `bonus` are what one quest and all three pay today,
//     with any event's boost, `times`).
//   POST { do: 'claim' }: pays every quest that's done and not paid yet, and the bonus once all three are. The
//     same answer, plus `added` and your new `clicks`.
// What's been paid is `quests: { day, done: [ids], bonus }` on the account's `click_game` document, changed in the
// same atomic update as the clicks and only if it's still what was read, so two tabs can't both collect.

const TRIES = 3;
const RECENT_MS = 36 * 3600 * 1000; // looked at for today's Daily Games posts

// What the account has done today, worked out from what the server already keeps.
async function look(db, user, today) {
    const doc = await db.collection('click_game').findOne(
        { userId: user.userId },
        { projection: { clicks: 1, clicker: 1, mediaDaily: 1, gameDaily: 1, trustleRewards: 1, quests: 1 } }
    );
    const n = puzzleNumber();
    const trustle = Boolean(doc && Array.isArray(doc.trustleRewards) && doc.trustleRewards.some((r) => r && r.n === n));
    // Daily Games results are kept by their puzzle's day, which can be yesterday's or tomorrow's: what counts
    // here is when they were posted.
    const recent = await db.collection('daily_scores').find(
        { userId: user.userId, savedAt: { $gte: new Date(Date.now() - RECENT_MS) } },
        { projection: { _id: 0, savedAt: 1 } }
    ).limit(20).toArray();
    const posts = recent.filter((r) => r.savedAt instanceof Date && dayOf(r.savedAt) === today).length;
    const paid = paidToday(doc && doc.quests, today);
    return { doc, paid, status: questStatus(today, factsOf(doc, today, { trustle, posts }), paid) };
}

const answer = (today, status, paid, times, extra = {}) => ({
    day: today, quests: status, reward: QUEST_REWARD * times, bonus: ALL_BONUS * times, bonusPaid: paid.bonus, times, ...extra,
});

async function claim(db, user, today, times) {
    const col = db.collection('click_game');
    for (let tries = 0; tries < TRIES; tries++) {
        const { doc, paid, status } = await look(db, user, today);
        const owed = toClaim(status, paid);
        if (!doc || !owed.added) return answer(today, status, paid, times, { added: 0, clicks: doc ? doc.clicks : 0 });
        const added = owed.added * times;
        const saved = doc.quests && doc.quests.day === today
            ? { 'quests.day': today, 'quests.done': { $size: paid.done.length }, 'quests.bonus': paid.bonus }
            : { 'quests.day': { $ne: today } };
        const now = { day: today, done: [...paid.done, ...owed.ids], bonus: paid.bonus || owed.bonus };
        const result = await col.findOneAndUpdate(
            { userId: user.userId, ...saved },
            { $inc: { clicks: added }, $set: { quests: now, username: user.username } },
            { returnDocument: 'after', projection: { clicks: 1 } }
        );
        const after = result && 'value' in result ? result.value : result;
        if (after) {
            const done = status.map((q) => ({ ...q, paid: q.paid || owed.ids.includes(q.id) }));
            return answer(today, done, now, times, { added, clicks: after.clicks });
        }
        // Another tab claimed in between: look again.
    }
    throw new Error('Quest claim kept losing races');
}

export default async function quests(req, res) {
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Log in to do Daily Quests.' });
    try {
        const db = await connectToDatabase();
        const today = dayOf();
        const times = await boost('quests');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
            const { paid, status } = await look(db, user, today);
            return res.status(200).json(answer(today, status, paid, times));
        }
        if (req.method === 'POST') {
            if (!req.body || req.body.do !== 'claim') return res.status(400).json({ error: 'That’s not something quests do.' });
            return res.status(200).json(await claim(db, user, today, times));
        }
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Quests API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
