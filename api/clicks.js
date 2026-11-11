import { connectToDatabase } from '../utils/db.js';
import { authenticateUser } from '../utils/auth.js';
import { CHANNELS } from '../scripts/tv-lineup.js';
import { dayOf, dailyClaim, dailyStatus } from '../scripts/milestones.js';

// At most MAX_CLICKS clicks per WINDOW_MS (the header clicker enforces the same limit).
// The server allows a little slack so network jitter doesn't reject honest clicks.
const MAX_CLICKS = 3;
const WINDOW_MS = 1000;
const JITTER_MS = 100;

// Watching Trusty TV (POST ?action=tv) earns TV_CLICKS clicks every TV_EVERY_MS, at most once per
// window for the account no matter how many tabs are open. The slack covers timer and network jitter.
const TV_CLICKS = 5;
const TV_EVERY_MS = 5000;
const TV_SLACK_MS = 500;
// Each reward also adds its seconds to the account's watch time for the channel that was on
// (`tvSeconds.<channel key>`), which the profile page uses to pick a favorite channel.
const TV_CHANNELS = new Set(CHANNELS.map((c) => c.key));

// The first click of each day (from midnight Eastern) also pays the daily bonus, which grows with every day in a
// row (dailyClaim() in scripts/milestones.js). The account's `daily` ({ day, streak }) says which day was last
// paid, and the bonus only goes in if that's still the day this click read, so two clicks at once can't both
// collect it. Returns { clicks, daily: { streak, added } }, or null if there's nothing to pay.
async function payDaily(collection, userId, last, today) {
    const claim = dailyClaim(last, today);
    if (!claim) return null;
    const result = await collection.findOneAndUpdate(
        { userId, 'daily.day': last && typeof last.day === 'string' ? last.day : { $exists: false } },
        {
            $inc: { clicks: claim.added },
            $set: { daily: { day: today, streak: claim.streak } }
        },
        { returnDocument: 'after', projection: { clicks: 1 } }
    );
    const doc = result && 'value' in result ? result.value : result;
    return doc ? { clicks: doc.clicks, daily: claim } : null;
}

export default async (req, res) => {
    const user = authenticateUser(req);
    if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const  db  = await connectToDatabase();
        const collection = db.collection('click_game');

        if (req.method === 'GET') {
            const userData = await collection.findOne({ userId: user.userId }, { projection: { clicks: 1, daily: 1 } });
            return res.status(200).json({
                clicks: userData ? userData.clicks : 0,
                // Whether today's bonus is still waiting for a click (the header clicker shows it).
                daily: dailyStatus(userData && userData.daily, dayOf(new Date()))
            });
        }

        if (req.method === 'POST' && req.query.action === 'tv') {
            const now = new Date();
            const cutoff = new Date(now.getTime() - TV_EVERY_MS + TV_SLACK_MS);
            const channel = req.body && TV_CHANNELS.has(req.body.channel) ? req.body.channel : null;
            const seconds = channel ? { [channel]: TV_EVERY_MS / 1000 } : {};
            const inc = { clicks: TV_CLICKS };
            if (channel) inc[`tvSeconds.${channel}`] = seconds[channel];
            const result = await collection.findOneAndUpdate(
                { userId: user.userId, lastTvReward: { $not: { $gt: cutoff } } },
                {
                    $inc: inc,
                    $set: { username: user.username, lastTvReward: now }
                },
                { returnDocument: 'after' }
            );
            const doc = result && 'value' in result ? result.value : result;
            if (doc) {
                return res.status(200).json({ clicks: doc.clicks, added: TV_CLICKS });
            }

            // No match: either this user has never clicked, or the last reward was too recent.
            const inserted = await collection.updateOne(
                { userId: user.userId },
                { $setOnInsert: { clicks: TV_CLICKS, username: user.username, lastTvReward: now, recent: [], tvSeconds: seconds } },
                { upsert: true }
            );
            if (inserted.upsertedCount) {
                return res.status(200).json({ clicks: TV_CLICKS, added: TV_CLICKS });
            }
            return res.status(429).json({ error: `Trusty TV gives ${TV_CLICKS} clicks every ${TV_EVERY_MS / 1000} seconds.` });
        }

        if (req.method === 'POST') {
            const now = new Date();
            const today = dayOf(now);
            const cutoff = new Date(now.getTime() - WINDOW_MS + JITTER_MS);
            // `recent` keeps the times of the last MAX_CLICKS clicks, newest first. A click only
            // counts if the oldest of those is outside the window (or there aren't that many yet).
            const result = await collection.findOneAndUpdate(
                { userId: user.userId, [`recent.${MAX_CLICKS - 1}`]: { $not: { $gt: cutoff } } },
                {
                    $inc: { clicks: 1 },
                    $set: { username: user.username, lastClicked: now },
                    $push: { recent: { $each: [now], $position: 0, $slice: MAX_CLICKS } }
                },
                { returnDocument: 'after', projection: { clicks: 1, daily: 1 } }
            );
            const doc = result && 'value' in result ? result.value : result;
            if (doc) {
                // The click already counted, so a problem with the bonus doesn't fail it: the next click tries again.
                const bonus = await payDaily(collection, user.userId, doc.daily, today).catch((error) => {
                    console.error('Daily bonus error:', error);
                    return null;
                });
                return res.status(200).json(bonus || { clicks: doc.clicks });
            }

            // No match: either this is the user's first click ever (which gets the first day's bonus too),
            // or they're clicking too fast.
            const first = dailyClaim(null, today);
            const inserted = await collection.updateOne(
                { userId: user.userId },
                { $setOnInsert: { clicks: 1 + first.added, username: user.username, lastClicked: now, recent: [now], daily: { day: today, streak: first.streak } } },
                { upsert: true }
            );
            if (inserted.upsertedCount) {
                return res.status(200).json({ clicks: 1 + first.added, daily: first });
            }
            return res.status(429).json({ error: `Slow down! Max ${MAX_CLICKS} clicks per second.` });
        }

        return res.status(405).json({ message: 'Method Not Allowed' });

    } catch (error) {
        console.error('Click API Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};