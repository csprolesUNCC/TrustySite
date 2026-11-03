import { connectToDatabase } from './db.js';

// Simple rate limits kept in the game db's `rate_limits` collection: a counter per key per time window,
// e.g. "gemini:<ip>" for each 10 minutes. Old counters delete themselves (a TTL index on expiresAt).
// Used by TrustyGPT (api/gemini.js) and the account endpoints (api/auth/*) so nobody can burn the Gemini
// quota, guess passwords or flood inboxes. If the database is down, nothing is limited.

let indexReady = null;
async function collection() {
    const db = await connectToDatabase();
    const col = db.collection('rate_limits');
    indexReady ??= col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { indexReady = null; });
    return col;
}

const windowOf = (windowMs, now = Date.now()) => Math.floor(now / windowMs);
const docId = (key, windowMs) => `${key}:${windowMs}:${windowOf(windowMs)}`;

/** Adds one to `key`'s count for this window and returns the new count (0 if the database can't be reached). */
export async function countHit(key, windowMs) {
    try {
        const col = await collection();
        const window = windowOf(windowMs);
        const result = await col.findOneAndUpdate(
            { _id: docId(key, windowMs) },
            { $inc: { n: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowMs) } },
            { upsert: true, returnDocument: 'after' }
        );
        const doc = result && 'value' in result ? result.value : result;
        return (doc && doc.n) || 0;
    } catch (error) {
        console.error('Rate limit error:', error);
        return 0;
    }
}

/** Whether `key` has already been counted `limit` times in this window (without counting this check). */
export async function overLimit(key, limit, windowMs) {
    try {
        const col = await collection();
        const doc = await col.findOne({ _id: docId(key, windowMs) }, { projection: { n: 1 } });
        return Boolean(doc && doc.n >= limit);
    } catch (error) {
        console.error('Rate limit error:', error);
        return false;
    }
}

/** The visitor's IP address. Vercel sets these headers itself, so they can't be faked. */
export function clientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return String(req.headers['x-real-ip'] || '') || forwarded || 'unknown';
}
