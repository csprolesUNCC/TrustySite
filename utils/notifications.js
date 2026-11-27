import { ObjectId } from 'mongodb';
import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { NOTES, BOARD_TOP, passedOn } from '../scripts/notifications.js';

// Notifications for the header's mail button (rules and shapes in scripts/notifications.js), served from
// api/leaderboard.js as ?action=notifications so they don't take up another Vercel function.
//   GET (logged in): { unread, notes }: how many haven't been seen, and the newest NOTES.shown.
//   POST { do: 'read' } (logged in): marks them all seen (the header does it when the list is opened).
// They're written by the things they're about: HayPay (utils/transfer.js) when a payment comes in, the weekly
// boards (utils/weekly.js) when a prize is paid, and the score endpoints when a new best passes someone on a
// board's top 10 (notifyPassed()). `notifications` keeps { userId, kind, ...fields, at, read }, and a TTL index in
// utils/db.js deletes each one NOTES.keepDays after it was sent.

const COLLECTION = 'notifications';

/**
 * Leaves a notification for `userId`. Never throws: a notification that didn't go in never stops what it's about.
 * @param {string} userId
 * @param {object} fields { kind, ... } (scripts/notifications.js)
 * @param {import('mongodb').Db} [db]
 */
export async function notify(userId, fields, db) {
  if (typeof userId !== 'string' || !userId) return;
  try {
    const col = (db || await connectToDatabase()).collection(COLLECTION);
    await col.insertOne({ ...fields, userId, at: new Date(), read: false });
  } catch (error) {
    console.error('Notification error:', error);
  }
}

/**
 * A board's top BOARD_TOP as it is now, for notifyPassed() once a new best has saved; null if it can't be read.
 * @param {import('mongodb').Collection} collection
 * @param {object} [filter]
 */
export async function boardBefore(collection, filter = {}) {
  try {
    return await collection
      .find(filter, { projection: { _id: 0, userId: 1, name: 1, score: 1 } })
      .sort({ score: -1, timestamp: 1 })
      .limit(BOARD_TOP)
      .toArray();
  } catch (error) {
    console.error('Notification board error:', error);
    return null;
  }
}

/**
 * After `user`'s new best of `score` saved on `game`'s board: tells everyone it passed on that board's top
 * BOARD_TOP (`top`, from boardBefore() just before the save). Never throws.
 * @param {'flappy' | 'draw' | 'trustis' | 'snake'} game
 * @param {object[] | null} top
 * @param {{ userId: string, username: string }} user
 * @param {number} score
 */
export async function notifyPassed(game, top, user, score) {
  const passed = passedOn(top, user.userId, score);
  if (!passed.length) return;
  const db = await connectToDatabase().catch(() => null);
  if (!db) return;
  await Promise.all(passed.map((p) => notify(p.userId, { kind: 'passed', game, by: user.username, rank: p.rank }, db)));
}

const shown = ({ _id, userId, ...note }) => ({ ...note, id: String(_id), at: note.at instanceof Date ? note.at.toISOString() : note.at });

export default async function notifications(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = authenticateUser(req);
  if (!user || user.userId == null) return res.status(401).json({ error: 'Authentication required' });
  const userId = String(user.userId);

  try {
    const col = (await connectToDatabase()).collection(COLLECTION);

    if (req.method === 'GET') {
      const [unread, notes] = await Promise.all([
        col.countDocuments({ userId, read: false }),
        col.find({ userId }).sort({ at: -1, _id: -1 }).limit(NOTES.shown).toArray(),
      ]);
      return res.status(200).json({ unread, notes: notes.map(shown) });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.do !== 'read') return res.status(400).json({ error: 'Invalid request' });
      // Only the ones sent up to now: one that comes in while the list is open stays new.
      const upTo = typeof body.upTo === 'string' && /^[a-f0-9]{24}$/.test(body.upTo) ? new ObjectId(body.upTo) : null;
      await col.updateMany({ userId, read: false, ...(upTo ? { _id: { $lte: upTo } } : {}) }, { $set: { read: true } });
      return res.status(200).json({ unread: await col.countDocuments({ userId, read: false }) });
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
  } catch (error) {
    console.error('Notifications API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
