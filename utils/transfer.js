import { ObjectId } from 'mongodb';
import { connectToDatabase } from './db.js';
import connectToUsersDatabase from './connect.js';
import { authenticateUser, tokenRevoked } from './auth.js';
import { isHouse } from './house.js';
import { dayOf } from './bank.js';
import { TRANSFER, cleanTransfer, canSend, sendableAt, sendLeft } from '../scripts/transfer.js';

// Trusty Venmo: sending site clicks to another player (the Send clicks button on profiles, pages/profile.html),
// served from api/leaderboard.js as ?action=transfer so it doesn't take up another Vercel function. The rules
// and limits are TRANSFER in scripts/transfer.js.
//   GET (logged in): { clicks, joined, sendableAt, canSend, left, house, recent }: your clicks, when your account can
//     start sending (it has to be TRANSFER.minAgeDays old), what's left of today's TRANSFER.perDay, and your last
//     payments both ways.
//   GET &q=<start of a name> (logged in): up to 8 usernames that start with it, for picking who to pay.
//   POST { to, amount, note }: pays `amount` of your clicks to the account named `to` (capitals aside). The
//     clicks come off yours in one atomic update that only goes in if you have them and they fit in today's
//     limit, so two tabs can never spend them twice; then they go onto theirs (a refund if that fails). Every
//     payment is written down in `transfers`, and the admin panel lists the ones of TRANSFER.review or more
//     (?action=admin&view=transfers, utils/moderation.js).
// On the account's `click_game` document, `transfer: { day, sent, received }` is today's (Eastern) payments,
// which the click bank takes back out of its limits (limitsOf() in utils/bank.js). Trusty's account is the house
// (utils/house.js) and can't send or receive.

const CASE_INSENSITIVE = { locale: 'en', strength: 2 }; // the same collation register.js checks names with
const RECENT = 10;
const SEARCH = 8;
const unwrap = (result) => (result && 'value' in result ? result.value : result);
const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const joinedOf = (account) => account.createdAt || account._id.getTimestamp();

// Today's count starts from zero with the first payment of a new day, both ways.
async function rollover(col, userId, today) {
  await col.updateOne({ userId, 'transfer.day': { $ne: today } }, { $set: { 'transfer.day': today, 'transfer.sent': 0, 'transfer.received': 0 } });
}

async function recent(db, userId) {
  const list = await db.collection('transfers').find(
    { $or: [{ from: userId }, { to: userId }], status: 'done' },
    { projection: { from: 1, fromName: 1, toName: 1, amount: 1, note: 1, at: 1 } }
  ).sort({ at: -1 }).limit(RECENT).toArray();
  return list.map((t) => ({
    sent: t.from === userId,
    name: t.from === userId ? t.toName : t.fromName,
    amount: t.amount,
    note: t.note || '',
    at: t.at,
  }));
}

async function search(usersDb, q) {
  const accounts = await usersDb.collection('users').find(
    { username: { $regex: `^${escapeRegex(q)}`, $options: 'i' } },
    { projection: { _id: 0, username: 1 } }
  ).sort({ username: 1 }).limit(SEARCH + 1).toArray();
  return accounts.map((a) => a.username).filter((name) => typeof name === 'string' && !isHouse(name)).slice(0, SEARCH);
}

async function status(db, account, now = new Date()) {
  const userId = String(account._id);
  const [doc, payments] = await Promise.all([
    db.collection('click_game').findOne({ userId }, { projection: { clicks: 1, transfer: 1 } }),
    recent(db, userId),
  ]);
  const joined = joinedOf(account);
  return {
    clicks: (doc && doc.clicks) || 0,
    joined,
    sendableAt: sendableAt(joined),
    canSend: canSend(joined, now),
    left: sendLeft(doc && doc.transfer, dayOf(now)),
    house: isHouse(account.username),
    recent: payments,
  };
}

export async function send(db, usersDb, account, order, now = new Date()) {
  const userId = String(account._id);
  if (isHouse(account.username)) return [403, { error: 'Trusty’s account is the house: it can’t send clicks.' }];
  const joined = joinedOf(account);
  if (!canSend(joined, now)) {
    return [403, { error: `Accounts can send clicks once they’re ${TRANSFER.minAgeDays} days old.`, sendableAt: sendableAt(joined) }];
  }

  const to = await usersDb.collection('users').findOne(
    { username: order.to },
    { collation: CASE_INSENSITIVE, projection: { username: 1 } }
  );
  if (!to) return [404, { error: `There’s no one called “${order.to}”.` }];
  const toId = String(to._id);
  if (toId === userId) return [400, { error: 'You can’t send clicks to yourself.' }];
  if (isHouse(to.username)) return [403, { error: 'Trusty’s account is the house: it can’t take clicks.' }];

  const col = db.collection('click_game');
  const log = db.collection('transfers');
  const today = dayOf(now);
  const { amount, note } = order;
  const record = { _id: new ObjectId(), from: userId, fromName: account.username, to: toId, toName: to.username, amount, note, at: now, status: 'pending' };
  await log.insertOne(record);

  await rollover(col, userId, today);
  const paid = unwrap(await col.findOneAndUpdate(
    { userId, clicks: { $gte: amount }, 'transfer.day': today, 'transfer.sent': { $lte: TRANSFER.perDay - amount } },
    { $inc: { clicks: -amount, 'transfer.sent': amount } },
    { returnDocument: 'after', projection: { clicks: 1, transfer: 1 } }
  ));
  if (!paid) {
    await log.deleteOne({ _id: record._id });
    const doc = await col.findOne({ userId }, { projection: { clicks: 1, transfer: 1 } });
    const clicks = (doc && doc.clicks) || 0;
    if (clicks < amount) return [400, { error: `You only have ${fmt(clicks)} clicks.`, clicks }];
    const left = sendLeft(doc && doc.transfer, today);
    return [429, { error: left ? `You can only send ${fmt(left)} more clicks today.` : `That’s the ${fmt(TRANSFER.perDay)} clicks you can send today. Try again after midnight.`, clicks, left }];
  }

  try {
    await rollover(col, toId, today);
    await col.updateOne(
      { userId: toId },
      { $inc: { clicks: amount, 'transfer.received': amount }, $set: { 'transfer.day': today }, $setOnInsert: { username: to.username, recent: [] } },
      { upsert: true }
    );
  } catch (error) {
    // Their side didn't go in: give the clicks back.
    console.error('Transfer: paying the receiver failed, refunding:', error);
    await col.updateOne({ userId }, { $inc: { clicks: amount, 'transfer.sent': -amount } });
    await log.updateOne({ _id: record._id }, { $set: { status: 'refunded' } }).catch(() => {});
    return [500, { error: 'Couldn’t send those clicks. You still have them: try again?' }];
  }
  await log.updateOne({ _id: record._id }, { $set: { status: 'done' } }).catch((error) => console.error('Transfer: marking it done failed:', error));
  console.log(`Transfer: ${account.username} sent ${amount} clicks to ${to.username}`);
  return [200, { sent: { to: to.username, amount, note }, clicks: paid.clicks, left: sendLeft(paid.transfer, today) }];
}

export default async function transfer(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = authenticateUser(req);
  if (!user || user.userId == null) return res.status(401).json({ error: 'Log in to send clicks.' });

  try {
    const { db: usersDb } = await connectToUsersDatabase();
    const account = await usersDb.collection('users').findOne(
      { _id: new ObjectId(String(user.userId)) },
      { projection: { username: 1, createdAt: 1, passwordChangedAt: 1 } }
    );
    if (!account || tokenRevoked(user, account)) return res.status(401).json({ error: 'Log in to send clicks.' });
    const db = await connectToDatabase();

    if (req.method === 'GET') {
      const q = req.query.q;
      if (q != null) {
        if (typeof q !== 'string' || q.trim().length < 1 || q.length > 32) return res.status(200).json({ names: [] });
        const names = await search(usersDb, q.trim());
        return res.status(200).json({ names: names.filter((name) => name !== account.username) });
      }
      return res.status(200).json(await status(db, account));
    }
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    const order = cleanTransfer(req.body);
    if (!order) return res.status(400).json({ error: `Send a whole number of clicks from ${TRANSFER.min} to ${fmt(TRANSFER.max)}, with a note of up to ${TRANSFER.noteMax} characters.` });
    const [code, answer] = await send(db, usersDb, account, order);
    return res.status(code).json(answer);
  } catch (error) {
    console.error('Transfer API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * The payments of TRANSFER.review clicks or more, newest first, for the admin panel (utils/moderation.js).
 * @param {number} limit
 */
export async function listPayments(limit = 500) {
  const db = await connectToDatabase();
  const list = await db.collection('transfers').find(
    { amount: { $gte: TRANSFER.review } },
    { projection: { fromName: 1, toName: 1, amount: 1, note: 1, at: 1, status: 1 } }
  ).sort({ at: -1 }).limit(limit).toArray();
  return list.map((t) => ({ id: String(t._id), from: t.fromName, to: t.toName, amount: t.amount, note: t.note || '', at: t.at, status: t.status }));
}
