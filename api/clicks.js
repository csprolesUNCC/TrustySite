import { connectToDatabase } from './db.js';
import { authenticateUser } from '../utils/auth.js';

// At most MAX_CLICKS clicks per WINDOW_MS (the header clicker enforces the same limit).
// The server allows a little slack so network jitter doesn't reject honest clicks.
const MAX_CLICKS = 3;
const WINDOW_MS = 1000;
const JITTER_MS = 100;

export default async (req, res) => {
    const user = authenticateUser(req);
    if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const  db  = await connectToDatabase();
        const collection = db.collection('click_game');

        if (req.method === 'GET') {
            const userData = await collection.findOne({ userId: user.userId });
            return res.status(200).json({ 
                clicks: userData ? userData.clicks : 0 
            });
        }

        if (req.method === 'POST') {
            const now = new Date();
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
                { returnDocument: 'after' }
            );
            const doc = result && 'value' in result ? result.value : result;
            if (doc) {
                return res.status(200).json({ clicks: doc.clicks });
            }

            // No match: either this is the user's first click ever, or they're clicking too fast.
            const inserted = await collection.updateOne(
                { userId: user.userId },
                { $setOnInsert: { clicks: 1, username: user.username, lastClicked: now, recent: [now] } },
                { upsert: true }
            );
            if (inserted.upsertedCount) {
                return res.status(200).json({ clicks: 1 });
            }
            return res.status(429).json({ error: `Slow down! Max ${MAX_CLICKS} clicks per second.` });
        }

        return res.status(405).json({ message: 'Method Not Allowed' });

    } catch (error) {
        console.error('Click API Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};