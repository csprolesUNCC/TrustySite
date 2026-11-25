import { connectToDatabase } from '../utils/db.js';
import { authenticateUser } from '../utils/auth.js';
import { CHANNELS } from '../scripts/tv-lineup.js';
import { WATCH_REWARD } from '../scripts/tv-schedule.js';
import { dayOf, dailyClaim, dailyStatus, CLICKER, CLICKER_LAST, pressPays, pressesToday } from '../scripts/milestones.js';
import { equippedOf, nameStyleOf } from '../scripts/shop.js';
import { boost } from '../utils/events.js';
import golden from '../utils/golden.js';

// At most MAX_CLICKS clicks per WINDOW_MS (the header clicker enforces the same limit).
// The server allows a little slack so network jitter doesn't reject honest clicks.
const MAX_CLICKS = 6;
const WINDOW_MS = 1000;
const JITTER_MS = 100;

// Watching Trusty TV (POST ?action=tv) or listening to Trusty Radio (POST ?action=radio) earns WATCH_REWARD.clicks
// every WATCH_REWARD.every seconds, at most once per window for the account no matter how many tabs are open, and at
// most WATCH_REWARD.daily clicks a day (midnight Eastern) from the two together, counted in the account's
// `mediaDaily` ({ day, clicks }). The slack covers timer and network jitter.
const WATCH_SLACK_MS = 500;
const MEDIA_DAILY = 'mediaDaily';
const WATCH = {
    // Each TV reward also adds its seconds to the account's watch time for the channel that was on
    // (`tvSeconds.<channel key>`), which the profile page uses to pick a favorite channel.
    tv: { name: 'Trusty TV', last: 'lastTvReward', daily: MEDIA_DAILY, seconds: 'tvSeconds', keys: new Set(CHANNELS.map((c) => c.key)) },
    radio: { name: 'Trusty Radio', last: 'lastRadioReward', daily: MEDIA_DAILY }
};

// Pays one watch reward if the last one was long enough ago and today's are under the cap. Returns [status, body].
async function payWatch(collection, user, source, body) {
    const { clicks: CLICKS, every, daily: CAP } = WATCH_REWARD;
    // An event can multiply what's paid (utils/events.js); the day's count and its cap stay in plain clicks, so
    // reaching the cap takes as long as ever.
    const PAID = CLICKS * await boost('watch');
    const now = new Date();
    const today = dayOf(now);
    const ready = { [source.last]: { $not: { $gt: new Date(now.getTime() - every * 1000 + WATCH_SLACK_MS) } } };
    const key = source.seconds && body && source.keys.has(body.channel) ? body.channel : null;
    const inc = { clicks: PAID };
    if (key) inc[`${source.seconds}.${key}`] = every;
    const set = { username: user.username, [source.last]: now };
    const options = { returnDocument: 'after', projection: { clicks: 1, [source.daily]: 1 } };
    const paid = (result) => {
        const doc = result && 'value' in result ? result.value : result;
        return doc ? { clicks: doc.clicks, added: PAID, today: doc[source.daily].clicks, cap: CAP } : null;
    };

    // Already paid some today: only while that's under the cap.
    let answer = paid(await collection.findOneAndUpdate(
        { userId: user.userId, ...ready, [`${source.daily}.day`]: today, [`${source.daily}.clicks`]: { $lte: CAP - CLICKS } },
        { $inc: { ...inc, [`${source.daily}.clicks`]: CLICKS }, $set: set },
        options
    ));
    // The day's first: today's count starts over.
    answer ||= paid(await collection.findOneAndUpdate(
        { userId: user.userId, ...ready, [`${source.daily}.day`]: { $ne: today } },
        { $inc: inc, $set: { ...set, [source.daily]: { day: today, clicks: CLICKS } } },
        options
    ));
    if (answer) return [200, answer];

    // No match: this user has never clicked, today's cap is reached, or the last reward was too recent.
    const inserted = await collection.updateOne(
        { userId: user.userId },
        {
            $setOnInsert: {
                clicks: PAID, username: user.username, [source.last]: now, recent: [],
                [source.daily]: { day: today, clicks: CLICKS },
                ...(source.seconds && { [source.seconds]: key ? { [key]: every } : {} })
            }
        },
        { upsert: true }
    );
    if (inserted.upsertedCount) {
        return [200, { clicks: PAID, added: PAID, today: CLICKS, cap: CAP }];
    }
    const doc = await collection.findOne({ userId: user.userId }, { projection: { [source.daily]: 1 } });
    const counted = doc && doc[source.daily];
    if (counted && counted.day === today && counted.clicks > CAP - CLICKS) {
        return [429, { error: `That's today's ${CAP} clicks from Trusty TV and Trusty Radio. More from midnight Eastern.`, capped: true, day: today, today: counted.clicks, cap: CAP }];
    }
    return [429, { error: `${source.name} gives ${CLICKS} clicks every ${every} seconds.` }];
}

// One press of the header clicker, as an update pipeline so it's a single atomic update: it counts the day's
// presses in `clicker` ({ day, n }, starting over each day) and pays a click only when pressPays() says that
// press does (scripts/milestones.js: every press up to CLICKER.full, then one in CLICKER.every, then none), and
// keeps `recent` (the times of the last MAX_CLICKS presses, newest first) for the rate limit.
export function pressUpdate(now, today, username) {
    const n = '$clicker.n';
    const pays = {
        $or: [
            { $lte: [n, CLICKER.full] },
            { $and: [{ $lte: [n, CLICKER_LAST] }, { $eq: [{ $mod: [{ $subtract: [n, CLICKER.full] }, CLICKER.every] }, 0] }] }
        ]
    };
    return [
        {
            $set: {
                clicker: {
                    $cond: [
                        { $and: [{ $eq: ['$clicker.day', today] }, { $gt: [{ $ifNull: ['$clicker.n', 0] }, 0] }] },
                        { day: today, n: { $add: ['$clicker.n', 1] } },
                        { day: today, n: 1 }
                    ]
                }
            }
        },
        {
            $set: {
                clicks: { $add: [{ $ifNull: ['$clicks', 0] }, { $cond: [pays, 1, 0] }] },
                username: { $literal: username },
                lastClicked: now,
                recent: { $slice: [{ $concatArrays: [[now], { $ifNull: ['$recent', []] }] }, MAX_CLICKS] }
            }
        }
    ];
}

// The first click of each day (from midnight Eastern) also pays the daily bonus, which grows with every day in a
// row (dailyClaim() in scripts/milestones.js). The account's `daily` ({ day, streak }) says which day was last
// paid, and the bonus only goes in if that's still the day this click read, so two clicks at once can't both
// collect it. Returns { clicks, daily: { streak, added } }, or null if there's nothing to pay.
async function payDaily(collection, userId, last, today) {
    const base = dailyClaim(last, today);
    if (!base) return null;
    // An event can multiply it (utils/events.js).
    const claim = { ...base, added: base.added * await boost('daily') };
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

        // Golden Trusties (utils/golden.js): GET asks whether one is due, POST catches one.
        if (req.query.action === 'golden') {
            const [status, answer] = await golden(collection, user, req.method, req.body);
            return res.status(status).json(answer);
        }

        if (req.method === 'GET') {
            const userData = await collection.findOne({ userId: user.userId }, { projection: { clicks: 1, daily: 1, clicker: 1, 'shop.owned': 1, 'shop.equipped': 1 } });
            const shop = userData && userData.shop;
            const today = dayOf(new Date());
            const daily = dailyStatus(userData && userData.daily, today);
            // While it's waiting, the bonus shown is what today's event (if any) makes it.
            if (daily.ready) daily.next *= await boost('daily');
            return res.status(200).json({
                clicks: userData ? userData.clicks : 0,
                // Today's presses, so the header knows how tired Trusty is (CLICKER in scripts/milestones.js).
                clicker: { day: today, n: pressesToday(userData && userData.clicker, today) },
                // Whether today's bonus is still waiting for a click (the header clicker shows it).
                daily,
                // The Item Shop's theme and name style they have on (scripts/shop.js), which every page puts on.
                shop: { theme: equippedOf(shop).theme, style: nameStyleOf(shop) }
            });
        }

        if (req.method === 'POST' && Object.hasOwn(WATCH, req.query.action)) {
            const [status, answer] = await payWatch(collection, user, WATCH[req.query.action], req.body);
            return res.status(status).json(answer);
        }

        if (req.method === 'POST') {
            const now = new Date();
            const today = dayOf(now);
            const cutoff = new Date(now.getTime() - WINDOW_MS + JITTER_MS);
            // A press only counts if the oldest of the last MAX_CLICKS is outside the window (or there aren't that
            // many yet).
            const result = await collection.findOneAndUpdate(
                { userId: user.userId, [`recent.${MAX_CLICKS - 1}`]: { $not: { $gt: cutoff } } },
                pressUpdate(now, today, user.username),
                { returnDocument: 'after', projection: { clicks: 1, daily: 1, clicker: 1 } }
            );
            const doc = result && 'value' in result ? result.value : result;
            if (doc) {
                // The click already counted, so a problem with the bonus doesn't fail it: the next click tries again.
                const bonus = await payDaily(collection, user.userId, doc.daily, today).catch((error) => {
                    console.error('Daily bonus error:', error);
                    return null;
                });
                // `added` is 0 once Trusty's tired and this press didn't pay; `clicker` is today's presses so far.
                const n = pressesToday(doc.clicker, today);
                const press = { added: pressPays(n) ? 1 : 0, clicker: { day: today, n } };
                return res.status(200).json(bonus ? { ...bonus, ...press } : { clicks: doc.clicks, ...press });
            }

            // No match: either this is the user's first click ever (which gets the first day's bonus too),
            // or they're clicking too fast.
            const first = dailyClaim(null, today);
            const inserted = await collection.updateOne(
                { userId: user.userId },
                { $setOnInsert: { clicks: 1 + first.added, username: user.username, lastClicked: now, recent: [now], daily: { day: today, streak: first.streak }, clicker: { day: today, n: 1 } } },
                { upsert: true }
            );
            if (inserted.upsertedCount) {
                return res.status(200).json({ clicks: 1 + first.added, daily: first, added: 1, clicker: { day: today, n: 1 } });
            }
            return res.status(429).json({ error: `Slow down! Max ${MAX_CLICKS} clicks per second.` });
        }

        return res.status(405).json({ message: 'Method Not Allowed' });

    } catch (error) {
        console.error('Click API Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};