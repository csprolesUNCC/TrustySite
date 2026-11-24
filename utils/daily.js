import { ObjectId } from 'mongodb';
import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { cachePublic } from './cache.js';
import { dayOf } from '../scripts/milestones.js';
import { GAME_KEYS, BOARD_KEYS, POST_REWARD, isDay, dayAfter, puzzleOn, parseShare, rankOf, flagsFor, cleanResult, statsFor } from '../scripts/daily-games.js';
import { puzzleNumber, puzzleWord, cleanGame, outcome, grade } from '../scripts/trustle.js';

// The Daily Games board (pages/daily.html), served from api/leaderboard.js as ?action=daily so it doesn't take
// up another Vercel function.
//   GET [&day=YYYY-MM-DD]: everyone's results for that day (today, Eastern, by default), public:
//     { day, today, boards: { trustle | wordle | connections | krillion: { n, entries: [{ id?, name, result, flags }] } } }.
//     Trustle's come from the games players already sync (api/trustle-api.js); the rest were pasted in.
//   POST { text }: the logged-in player posts one game's share text. scripts/daily-games.js reads and checks it;
//     one result per player per game per day, and the first one stays. Posting pays POST_REWARD clicks (the
//     answer's `reward`: { added, clicks }, or null if paying failed; the result is saved either way).
//   POST { do: 'report', id }: a logged-in player reports someone else's result, once.
// It's the honor system (nothing can check another site's score), so the reward is the same whatever the
// result: only posting earns it, and the unique index means each game pays once a day. Results that look too
// good are flagged when they're posted (flagsFor), which shows "Sus?" on the board until an admin clears it;
// flagged and reported results are listed in the admin panel (utils/moderation.js, view=daily), which can take
// one down. A result that's been taken down stays in `daily_scores` as `removed`, so it can't be posted again.

const COLLECTION = 'daily_scores';
const MAX_ENTRIES = 100; // per board
const HISTORY = 30; // earlier results looked at for flags
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const EARLIEST = '2021-06-19'; // Wordle #0, the oldest day any board can have

const LIVE = { removed: { $ne: true } };
// What the board shows of a flag: only ones an admin hasn't cleared.
const openFlags = (doc) => (doc.cleared || !Array.isArray(doc.flags) ? [] : doc.flags.filter((f) => typeof f === 'string'));

// Trustle's puzzle on `day`: its puzzles also start at midnight Eastern, so noon that day is safely inside it.
const trustleOn = (day) => puzzleNumber(Date.parse(`${day}T17:00:00Z`));

const TILE = { correct: 'c', present: 'p', absent: 'a' };
// Everyone's finished game of Trustle puzzle `n`, as board entries. Guesses become colors only, like a shared
// result, so the board never gives the word away.
async function trustleBoard(db, n) {
    const docs = await db.collection('trustle').find(
        { [`games.${n}`]: { $exists: true } },
        { projection: { _id: 0, username: 1, [`games.${n}`]: 1 } }
    ).limit(1000).toArray();
    const answer = puzzleWord(n).word;
    const entries = [];
    for (const doc of docs) {
        const game = cleanGame(n, doc.games && doc.games[n]);
        if (!game || game.legacy || typeof doc.username !== 'string') continue;
        const { done, won, tries } = outcome(n, game);
        if (!done) continue;
        const grid = game.guesses.map((guess) => grade(guess, answer).map((state) => TILE[state]).join(''));
        const result = { won, tries, grid };
        entries.push({ name: doc.username, result, rank: rankOf('trustle', result), flags: [] });
    }
    entries.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    return entries.slice(0, MAX_ENTRIES).map(({ rank, ...entry }) => entry);
}

async function getBoards(req, res) {
    const today = dayOf();
    const day = req.query.day === undefined ? today : req.query.day;
    if (!isDay(day) || day < EARLIEST || day > dayAfter(today)) return res.status(400).json({ error: 'Invalid day' });

    const db = await connectToDatabase();
    const n = trustleOn(day);
    const [trustle, docs] = await Promise.all([
        trustleBoard(db, n),
        db.collection(COLLECTION).find({ day, ...LIVE }, { projection: { userId: 0, reportedBy: 0 } })
            .sort({ rank: 1, savedAt: 1 }).limit(MAX_ENTRIES * GAME_KEYS.length).toArray(),
    ]);
    const boards = { trustle: { n, entries: trustle } };
    for (const game of GAME_KEYS) boards[game] = { n: puzzleOn(game, day), entries: [] };
    for (const doc of docs) {
        const board = boards[doc.game];
        const result = board && cleanResult(doc.game, doc.result);
        if (!result || board.entries.length >= MAX_ENTRIES) continue;
        board.entries.push({ id: String(doc._id), name: doc.name, result, flags: openFlags(doc) });
    }
    cachePublic(req, res);
    return res.status(200).json({ day, today, boards });
}

async function postScore(req, res, user) {
    const read = parseShare(req.body && req.body.text);
    if (read.error) return res.status(400).json({ error: read.error });

    const db = await connectToDatabase();
    const scores = db.collection(COLLECTION);
    const mine = { userId: String(user.userId), game: read.game };
    if (await scores.findOne({ ...mine, day: read.day }, { projection: { _id: 1 } })) {
        return res.status(409).json({ error: 'You’ve already posted that one. The first result you post is the one that counts.' });
    }
    const history = (await scores.find({ ...mine, ...LIVE, day: { $lt: read.day } }, { projection: { result: 1 } })
        .sort({ day: -1 }).limit(HISTORY).toArray())
        .map((doc) => cleanResult(read.game, doc.result)).filter(Boolean);
    const doc = {
        ...mine,
        name: user.username,
        n: read.n,
        day: read.day,
        result: read.result,
        rank: rankOf(read.game, read.result),
        flags: flagsFor(read.game, read.result, history),
        cleared: false,
        reports: 0,
        reportedBy: [],
        savedAt: new Date(),
    };
    let insertedId;
    try {
        ({ insertedId } = await scores.insertOne(doc));
    } catch (error) {
        // Another tab posted the same game first (the index on userId, game and day is unique).
        if (error && error.code === 11000) return res.status(409).json({ error: 'You’ve already posted that one.' });
        throw error;
    }
    const reward = await payPost(db, user);
    return res.status(201).json({ day: doc.day, reward, entry: { id: String(insertedId), game: doc.game, n: doc.n, name: doc.name, result: doc.result, flags: doc.flags } });
}

// The clicks for a result that was just saved. Only the insert that won the unique index gets here, so each
// game pays once per day without any counting of its own.
async function payPost(db, user) {
    try {
        const paid = await db.collection('click_game').findOneAndUpdate(
            { userId: user.userId },
            { $inc: { clicks: POST_REWARD }, $set: { username: user.username }, $setOnInsert: { recent: [] } },
            { upsert: true, returnDocument: 'after', projection: { clicks: 1 } }
        );
        const after = paid && 'value' in paid ? paid.value : paid;
        return { added: POST_REWARD, clicks: after ? after.clicks : null };
    } catch (error) {
        console.error('Daily Games reward error:', error);
        return null;
    }
}

async function report(req, res, user) {
    const id = req.body && req.body.id;
    if (typeof id !== 'string' || !OBJECT_ID.test(id)) return res.status(400).json({ error: 'Invalid result' });
    const db = await connectToDatabase();
    const scores = db.collection(COLLECTION);
    const me = String(user.userId);
    const ref = { _id: new ObjectId(id), ...LIVE };
    const done = await scores.updateOne({ ...ref, userId: { $ne: me }, reportedBy: { $ne: me } }, { $push: { reportedBy: me }, $inc: { reports: 1 } });
    if (done.matchedCount) return res.status(201).json({ message: 'Reported' });
    const doc = await scores.findOne(ref, { projection: { userId: 1 } });
    if (!doc) return res.status(404).json({ error: 'That result has been taken down.' });
    if (doc.userId === me) return res.status(400).json({ error: 'You can’t report your own result.' });
    return res.status(200).json({ message: 'Already reported' });
}

/* ---------- For the admin panel (utils/moderation.js) ---------- */

const MAX_FLAGGED = 300;

/** Results with flags nobody has cleared, or open reports, newest first. */
export async function listFlagged() {
    const db = await connectToDatabase();
    const docs = await db.collection(COLLECTION).find(
        { ...LIVE, $or: [{ cleared: false, 'flags.0': { $exists: true } }, { reports: { $gt: 0 } }] },
        { projection: { userId: 0, reportedBy: 0 } }
    ).sort({ savedAt: -1 }).limit(MAX_FLAGGED).toArray();
    return docs.flatMap((doc) => {
        const result = cleanResult(doc.game, doc.result);
        if (!result || !BOARD_KEYS.includes(doc.game)) return [];
        return [{ id: String(doc._id), name: doc.name, game: doc.game, n: doc.n, day: doc.day, result, flags: openFlags(doc), reports: Number(doc.reports) || 0, at: doc.savedAt }];
    });
}

/**
 * Takes a result down ('remove') or clears its flags and reports ('dismiss').
 * @returns {Promise<boolean|null>} Whether it was done, or null if the request doesn't make sense.
 */
export async function moderateScore(body) {
    const { id, do: action } = body || {};
    if (typeof id !== 'string' || !OBJECT_ID.test(id) || (action !== 'remove' && action !== 'dismiss')) return null;
    const db = await connectToDatabase();
    const change = action === 'remove'
        ? { $set: { removed: true, removedAt: new Date() } }
        : { $set: { cleared: true, reports: 0 } };
    const done = await db.collection(COLLECTION).updateOne({ _id: new ObjectId(id), ...LIVE }, change);
    return done.matchedCount > 0;
}

/* ---------- For profiles (utils/profile.js) ---------- */

/** A player's stats at each pasted-in game they've posted, { [game]: statsFor(...) }. */
export async function dailyStats(db, userId) {
    const docs = await db.collection(COLLECTION).find({ userId: String(userId), ...LIVE }, { projection: { game: 1, day: 1, result: 1 } })
        .sort({ day: -1 }).limit(2000).toArray();
    const today = dayOf();
    const stats = {};
    for (const game of GAME_KEYS) {
        const entries = docs.filter((d) => d.game === game).map((d) => ({ day: d.day, result: cleanResult(game, d.result) })).filter((e) => e.result && isDay(e.day));
        if (entries.length) stats[game] = statsFor(game, entries, today);
    }
    return stats;
}

export default async function daily(req, res) {
    try {
        if (req.method === 'GET') return await getBoards(req, res);
        if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
        const user = authenticateUser(req);
        if (!user) return res.status(401).json({ error: 'Log in to post your results.' });
        if (req.body && req.body.do === 'report') return await report(req, res, user);
        return await postScore(req, res, user);
    } catch (error) {
        console.error('Daily API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
