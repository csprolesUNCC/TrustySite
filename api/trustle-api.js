import { connectToDatabase } from '../utils/db.js';
import { authenticateUser } from '../utils/auth.js';
import { MAX_GUESSES, puzzleNumber, cleanGame, outcome, mergeGame, sameGame, rewardFor, rewardable } from '../scripts/trustle.js';

// Keeps a logged-in player's Trustle history so it follows them between devices, and pays the clicks a
// finished game earns.
// POST { games: { [puzzle number]: game } } merges those games into the account (the same way the page
// merges them, see scripts/trustle.js), pays for any finished game that's owed (payRewards) and answers with
// the account's whole history and its Trustle clicks: { games, rewards, added, clicks }. Sending {} just
// fetches it.
// GET ?n=<puzzle number> is "how everyone else did": counted from the same histories, so nothing extra is
// stored. Public; when logged in, your own game is left out.

const MAX_GAMES = 1000;
// How many paid puzzles each account remembers. A puzzle can only be paid within a day of today's
// (rewardable), and in that time at most 4 others can be paid, so keeping a week's worth means none is
// ever paid twice.
const KEEP_REWARDS = 7;

const unwrap = (result) => (result && 'value' in result ? result.value : result);

// Pays the clicks for every finished game in `games` within a day of today's puzzle that the account hasn't
// been paid for yet, worked out from the game itself (rewardFor), not from anything the page says. The clicks
// (the header clicker's, in click_game) and the note of what was paid (`trustleRewards` on the same document:
// { n, clicks } for the last KEEP_REWARDS puzzles) change in one atomic update, so two tabs or a retried
// request can never be paid twice for a puzzle. Answers { rewards, added, clicks }: what the recent puzzles
// paid ({ [puzzle number]: clicks }), how many clicks this request added, and the account's new total.
async function payRewards(db, user, games) {
    const col = db.collection('click_game');
    const fields = { projection: { clicks: 1, trustleRewards: 1 } };
    let doc = await col.findOne({ userId: user.userId }, fields);
    let added = 0;
    const today = puzzleNumber();
    for (const key of Object.keys(games)) {
        const n = Number(key);
        const clicks = rewardable(n, today) ? rewardFor(n, cleanGame(n, games[key])) : 0;
        if (!clicks || ((doc && doc.trustleRewards) || []).some((r) => r.n === n)) continue;
        const paid = { n, clicks };
        const after = unwrap(await col.findOneAndUpdate(
            { userId: user.userId, 'trustleRewards.n': { $ne: n } },
            {
                $inc: { clicks },
                $set: { username: user.username },
                $push: { trustleRewards: { $each: [paid], $slice: -KEEP_REWARDS } }
            },
            { ...fields, returnDocument: 'after' }
        ));
        if (after) {
            doc = after;
            added += clicks;
            continue;
        }
        // No match: either this account has never clicked, or another request has just paid for this puzzle.
        const inserted = await col.updateOne(
            { userId: user.userId },
            { $setOnInsert: { clicks, username: user.username, recent: [], trustleRewards: [paid] } },
            { upsert: true }
        );
        if (inserted.upsertedCount) added += clicks;
        doc = await col.findOne({ userId: user.userId }, fields);
    }
    const rewards = {};
    for (const { n, clicks } of (doc && doc.trustleRewards) || []) rewards[n] = clicks;
    return { rewards, added, clicks: (doc && doc.clicks) || 0 };
}

// { players, dist, lost } for puzzle `n`: finished games only, `dist[i]` is how many got it in i + 1. Days
// rebuilt from the old stats (legacy) only roughly match their puzzle, so they don't count.
async function everyone(req, res) {
    const n = Number(req.query.n);
    if (!Number.isInteger(n) || n < 1 || n > puzzleNumber() + 1) return res.status(400).json({ error: 'Invalid puzzle' });
    const user = authenticateUser(req);

    const db = await connectToDatabase();
    const docs = await db.collection('trustle').find(
        { [`games.${n}`]: { $exists: true }, ...(user && { userId: { $ne: user.userId } }) },
        { projection: { _id: 0, [`games.${n}`]: 1 } }
    ).toArray();

    const counts = { players: 0, dist: Array(MAX_GUESSES).fill(0), lost: 0 };
    for (const doc of docs) {
        const game = cleanGame(n, doc.games && doc.games[n]);
        if (!game || game.legacy) continue;
        const result = outcome(n, game);
        if (!result.done) continue;
        counts.players += 1;
        if (result.won) counts.dist[result.tries - 1] += 1;
        else counts.lost += 1;
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(counts);
}

export default async (req, res) => {
    if (req.method === 'GET') {
        try {
            return await everyone(req, res);
        } catch (error) {
            console.error('Trustle API Error:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const sent = req.body && typeof req.body.games === 'object' && req.body.games ? req.body.games : {};
    const keys = Object.keys(sent);
    if (keys.length > MAX_GAMES) return res.status(400).json({ error: 'Too many games' });

    try {
        const db = await connectToDatabase();
        const collection = db.collection('trustle');
        const doc = await collection.findOne({ userId: user.userId });
        const games = (doc && doc.games) || {};

        // Puzzles that haven't started yet can't have been played (one day of slack for clock trouble).
        const latest = puzzleNumber() + 1;
        const changes = {};
        for (const key of keys) {
            const n = Number(key);
            if (!(n <= latest)) continue;
            const game = cleanGame(n, sent[key]);
            if (!game) continue;
            const merged = mergeGame(games[n] && cleanGame(n, games[n]), game);
            if (!sameGame(merged, games[n])) {
                games[n] = merged;
                changes[`games.${n}`] = merged;
            }
        }

        if (Object.keys(changes).length) {
            await collection.updateOne(
                { userId: user.userId },
                { $set: { ...changes, username: user.username, updatedAt: new Date() } },
                { upsert: true }
            );
        }
        return res.status(200).json({ games, ...(await payRewards(db, user, games)) });
    } catch (error) {
        console.error('Trustle API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
