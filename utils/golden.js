import { randomBytes, randomInt } from 'node:crypto';
import { boost } from './events.js';
import { dayOf } from '../scripts/milestones.js';
import { GOLDEN, TOKEN, decide, prize } from '../scripts/golden.js';

// Golden Trusties (rules in scripts/golden.js), served from api/clicks.js as ?action=golden. Logged in only.
//   GET: whether one is out for you now: { show: { token, ms } | null, wait, left }. `wait` is how long until the
//     next one is due (the page asks again then), null once today's are caught.
//   POST { token }: catches the one that token is for, if it's still out: { added, clicks, left }, or 410.
// The day's state is `golden` on the account's `click_game` document (decide() in scripts/golden.js). It's only
// saved if it's still what was read, and a catch is one atomic update that takes the token away, so two tabs can
// never catch the same one twice. Only accounts that have clicked Trusty (have a `click_game` document) get them.

const random = () => randomInt(0, 2 ** 31) / 2 ** 31;
const token = () => randomBytes(16).toString('hex');

// The filter for "golden is still what was read".
function unchanged(saved, today) {
    if (!(saved && saved.day === today)) return { 'golden.day': { $ne: today } };
    return { 'golden.day': today, 'golden.n': saved.n, 'golden.next': saved.next };
}

async function look(collection, user) {
    const today = dayOf();
    const doc = await collection.findOne({ userId: user.userId }, { projection: { golden: 1 } });
    if (!doc) return [200, { show: null, wait: null, left: 0 }];
    const saved = doc.golden || null;
    const now = Date.now();
    const next = decide(saved, today, now, random, token);
    if (next.state) {
        const result = await collection.updateOne({ userId: user.userId, ...unchanged(saved, today) }, { $set: { golden: next.state } });
        // Another tab got there first: it'll show the one that tab was given (if any), so this one waits a bit.
        if (!result.modifiedCount) return [200, { show: null, wait: 30 * 1000, left: next.left }];
    }
    return [200, { show: next.show, wait: next.wait, left: next.left }];
}

async function catchOne(collection, user, body) {
    const sent = body && body.token;
    if (typeof sent !== 'string' || !TOKEN.test(sent)) return [400, { error: 'That’s not a Golden Trusty.' }];
    const today = dayOf();
    const added = prize(random) * await boost('golden');
    const result = await collection.findOneAndUpdate(
        { userId: user.userId, 'golden.day': today, 'golden.token': sent, 'golden.until': { $gt: Date.now() }, 'golden.n': { $lt: GOLDEN.perDay } },
        { $inc: { clicks: added, 'golden.n': 1 }, $unset: { 'golden.token': '', 'golden.until': '' } },
        { returnDocument: 'after', projection: { clicks: 1, golden: 1 } }
    );
    const doc = result && 'value' in result ? result.value : result;
    if (!doc) return [410, { error: 'Too slow! That Golden Trusty got away.' }];
    return [200, { added, clicks: doc.clicks, left: Math.max(0, GOLDEN.perDay - doc.golden.n) }];
}

export default async function golden(collection, user, method, body) {
    if (method === 'GET') return look(collection, user);
    if (method === 'POST') return catchOne(collection, user, body);
    return [405, { message: 'Method Not Allowed' }];
}
