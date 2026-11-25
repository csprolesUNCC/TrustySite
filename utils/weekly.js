import { ObjectId } from 'mongodb';
import { connectToDatabase } from './db.js';
import { authenticateUser, isAdmin } from './auth.js';
import { currentAccount } from './rename.js';
import { cachePublic } from './cache.js';
import { WEEKLY_BOARDS, PLACES, DEFAULT_SETTINGS, cleanSettings, winnersOf, weekOf, weekBefore, weekEnds } from '../scripts/weekly.js';

// Weekly leaderboards (rules in scripts/weekly.js), served from api/leaderboard.js as ?action=weekly so they don't
// take up another Vercel function.
//   GET: this week's boards, the same for everyone (CDN-cached like the other boards, &fresh=1 skips it):
//     { week, ends, settings, boards: { [game]: { players, entries: [{ name, score }], last } } }, where `last` is
//     what last week paid: { week, players, on, minPlayers, winners: [{ name, score, place, prize }] } or null.
//   GET &admin=1 (admins): the same with every entry's `id`, for taking a score down, and no cache.
//   POST { do: 'settings', on, prizes, minPlayers } (admins): what the weeks from now on pay.
//   POST { do: 'remove', id } (admins): takes a score off this week's board. The player can't get back on it
//     until next week, so a made-up score can be taken down before it's paid.
//
// `weekly_scores` keeps each player's best game per board per week ({ userId, game, week, name, score,
// timestamp }, one per player per board per week: a unique index in utils/db.js). Every score endpoint calls
// recordWeekly() with each game it saves, best or not.
//
// Paying: there's no clock on the server, so the first request after a week ends (any weekly GET) pays it.
// Each finished board gets a `weekly_payouts` document (`_id` '<game>:<week>') with its winners, worked out once
// with the settings of the moment; then each winner is paid with one atomic update of their `click_game`
// document that also adds the payout's id to `weeklyPrizes` and only goes in if it isn't there yet, so two
// requests settling at once, or a retry after a crash, never pay anyone twice. Then the payout is marked done.

const SCORES = 'weekly_scores';
const PAYOUTS = 'weekly_payouts';
const SETTINGS = 'weekly_settings';
const SHOWN = 10;
// Payout ids kept on a player's `click_game`: far more than the boards of the two weeks settleWeeks() checks.
const KEEP_PAID = 20;
// Each server keeps the settings this long before asking again.
const KEEP_MS = 30 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/;

const live = { removed: { $ne: true } };
let keptSettings = null; // { settings, at }
let settledThrough = null; // the newest finished week this server has seen paid out

export async function weeklySettings(db) {
    if (keptSettings && Date.now() - keptSettings.at < KEEP_MS) return keptSettings.settings;
    const doc = await db.collection(SETTINGS).findOne({}, { sort: { savedAt: -1 } });
    const settings = cleanSettings(doc) || { ...DEFAULT_SETTINGS, prizes: [...DEFAULT_SETTINGS.prizes] };
    keptSettings = { settings, at: Date.now() };
    return settings;
}

/**
 * Puts a finished game on this week's board if it beats the player's best there. Never throws: a problem here
 * never stops the score saving or paying.
 * @param {{ userId: string, username: string }} user
 * @param {'flappy' | 'draw' | 'trustis' | 'snake'} game
 * @param {number} score
 */
export async function recordWeekly(user, game, score, at = new Date()) {
    if (!(score > 0)) return;
    try {
        const col = (await connectToDatabase()).collection(SCORES);
        const key = { userId: user.userId, game, week: weekOf(at.getTime()) };
        const saved = { name: user.username, score, timestamp: at };
        // A score an admin took down stays down for the week: neither of these touches it.
        const raised = await col.updateOne({ ...key, ...live, score: { $lt: score } }, { $set: saved });
        if (raised.matchedCount) return;
        await col.updateOne(key, { $setOnInsert: saved }, { upsert: true });
    } catch (error) {
        // 11000: another request saved this player's first game of the week at the same moment.
        if (error && error.code === 11000) return;
        console.error('Weekly board error:', error);
    }
}

const topOf = (db, game, week, limit, withIds = false) => db.collection(SCORES)
    .find({ game, week, ...live }, { projection: { _id: withIds ? 1 : 0, userId: 1, name: 1, score: 1, timestamp: 1 } })
    .sort({ score: -1, timestamp: 1 })
    .limit(limit)
    .toArray();

const playersOf = (db, game, week) => db.collection(SCORES).countDocuments({ game, week, ...live });

async function payPrize(db, winner, payoutId) {
    const col = db.collection('click_game');
    const paid = await col.updateOne(
        { userId: winner.userId, weeklyPrizes: { $ne: payoutId } },
        { $inc: { clicks: winner.prize }, $push: { weeklyPrizes: { $each: [payoutId], $slice: -KEEP_PAID } } }
    );
    if (paid.matchedCount) return;
    // Nothing matched: either they were already paid, or they've never clicked Trusty and have no document yet.
    await col.updateOne(
        { userId: winner.userId },
        { $setOnInsert: { clicks: winner.prize, username: winner.name, recent: [], weeklyPrizes: [payoutId] } },
        { upsert: true }
    );
}

async function settleBoard(db, game, week, settings) {
    const payouts = db.collection(PAYOUTS);
    const _id = `${game}:${week}`;
    let payout = await payouts.findOne({ _id });
    if (!payout) {
        const [players, top] = await Promise.all([playersOf(db, game, week), topOf(db, game, week, PLACES)]);
        const winners = winnersOf(top, players, settings)
            .map(({ userId, name, score, place, prize }) => ({ userId, name, score, place, prize }));
        payout = { _id, game, week, players, winners, settings, done: false, savedAt: new Date() };
        try {
            await payouts.insertOne(payout);
        } catch (error) {
            if (!error || error.code !== 11000) throw error;
            // Another request worked it out first: pay what it wrote down.
            payout = await payouts.findOne({ _id });
        }
    }
    if (payout.done) return;
    for (const winner of payout.winners) await payPrize(db, winner, _id);
    await payouts.updateOne({ _id }, { $set: { done: true, paidAt: new Date() } });
    if (payout.winners.length) {
        console.log(`Weekly ${game} ${week}: paid ${payout.winners.map((w) => `${w.name} ${w.prize}`).join(', ')}`);
    }
}

// Pays every board of the last two finished weeks that hasn't been paid yet (two, so a week nobody looked at
// the boards after is still paid).
export async function settleWeeks(db, now = Date.now()) {
    const last = weekBefore(weekOf(now));
    if (settledThrough === last) return;
    const weeks = [weekBefore(last), last];
    const ids = weeks.flatMap((week) => WEEKLY_BOARDS.map((game) => `${game}:${week}`));
    const done = new Set((await db.collection(PAYOUTS)
        .find({ _id: { $in: ids }, done: true }, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
    if (done.size < ids.length) {
        const settings = await weeklySettings(db);
        for (const week of weeks) {
            for (const game of WEEKLY_BOARDS) {
                if (!done.has(`${game}:${week}`)) await settleBoard(db, game, week, settings);
            }
        }
    }
    settledThrough = last;
}

const shownWinner = ({ name, score, place, prize }) => ({ name, score, place, prize });

async function boardsOf(db, week, { admin = false } = {}) {
    const lastWeek = weekBefore(week);
    const payouts = await db.collection(PAYOUTS)
        .find({ _id: { $in: WEEKLY_BOARDS.map((game) => `${game}:${lastWeek}`) } }).toArray();
    const lastOf = Object.fromEntries(payouts.map((p) => [p.game, {
        week: p.week, players: p.players, on: p.settings.on, minPlayers: p.settings.minPlayers, winners: p.winners.map(shownWinner),
    }]));
    const boards = {};
    await Promise.all(WEEKLY_BOARDS.map(async (game) => {
        const [players, top] = await Promise.all([playersOf(db, game, week), topOf(db, game, week, SHOWN, admin)]);
        boards[game] = {
            players,
            entries: top.map((e) => (admin ? { id: String(e._id), name: e.name, score: e.score, at: e.timestamp } : { name: e.name, score: e.score })),
            last: lastOf[game] || null,
        };
    }));
    return boards;
}

async function adminOnly(req, res) {
    const user = authenticateUser(req);
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return null; }
    if (!isAdmin(user)) { res.status(403).json({ error: 'Admins only' }); return null; }
    if ((await currentAccount(user)).revoked) { res.status(401).json({ error: 'Authentication required' }); return null; }
    return user;
}

async function getWeekly(req, res) {
    const admin = Boolean(req.query.admin);
    if (admin && !(await adminOnly(req, res))) return;
    const db = await connectToDatabase();
    // A problem paying out never keeps the boards from showing; the next request tries again.
    await settleWeeks(db).catch((error) => console.error('Weekly payout error:', error));
    const week = weekOf();
    const [settings, boards] = await Promise.all([weeklySettings(db), boardsOf(db, week, { admin })]);
    if (admin) res.setHeader('Cache-Control', 'no-store');
    else cachePublic(req, res);
    return res.status(200).json({ week, ends: weekEnds(week), settings, boards });
}

async function postWeekly(req, res) {
    const user = await adminOnly(req, res);
    if (!user) return;
    const db = await connectToDatabase();
    const body = req.body || {};

    if (body.do === 'remove') {
        if (typeof body.id !== 'string' || !OBJECT_ID.test(body.id)) return res.status(400).json({ error: 'Invalid score' });
        // Only this week's: a finished week's winners are already worked out.
        const done = await db.collection(SCORES).updateOne(
            { _id: new ObjectId(body.id), week: weekOf(), ...live },
            { $set: { removed: true, removedBy: user.username } }
        );
        if (!done.matchedCount) return res.status(409).json({ error: 'That score was already taken down, or its week is over.' });
        console.log(`Admin ${user.username}: took weekly score ${body.id} down`);
        return res.status(200).json({ ok: true });
    }

    if (body.do === 'settings') {
        const settings = cleanSettings(body);
        if (!settings) return res.status(400).json({ error: 'Each place pays a whole number of clicks, and at least 1 player has to play.' });
        await db.collection(SETTINGS).insertOne({ ...settings, by: user.username, savedAt: new Date() });
        keptSettings = null;
        console.log(`Admin ${user.username}: weekly prizes ${settings.on ? settings.prizes.join('/') : 'off'}, ${settings.minPlayers}+ players`);
        return res.status(200).json({ settings });
    }

    return res.status(400).json({ error: 'Invalid request' });
}

export default async function weekly(req, res) {
    try {
        if (req.method === 'GET') return await getWeekly(req, res);
        if (req.method === 'POST') return await postWeekly(req, res);
        return res.status(405).json({ message: 'Method Not Allowed' });
    } catch (error) {
        console.error('Weekly API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
