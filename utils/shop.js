import { connectToDatabase } from './db.js';
import { authenticateUser } from './auth.js';
import { cachePublic } from './cache.js';
import { dayOf } from './bank.js';
import { isHouse } from './house.js';
import { ITEMS, ownedSet, equippedOf, nameStyleOf, cleanOrder, isFree } from '../scripts/shop.js';

// The Item Shop (pages/shop.html), served from api/leaderboard.js as ?action=shop so it doesn't take up another
// Vercel function. What's for sale is scripts/shop.js. What an account bought is kept on its `click_game` document,
// next to the clicks that pay for it: `shop: { owned: [id], equipped: { theme, font, color, highlight }, spent, day,
// today }` (`spent` is every click spent there, `today` what was spent on `day`, Eastern, for the bank's limits).
//   GET &n=<name>&n=<name>... (public): how those players' names look, { styles: { [name]: { font, color,
//     highlight } } }, only for names that aren't all the defaults. Every page that shows names asks for them
//     (nameStyles() in scripts/site.js); themes are never in it, since only their owner sees them.
//   GET (logged in): { clicks, owned, equipped, spent, house }: your clicks and what you have.
//   POST { do: 'buy', id }: buys an item and puts it on. One atomic update takes the price off your clicks and adds
//     the item, and only if you have the clicks and don't own it yet, so two tabs can never pay twice.
//   POST { do: 'equip', id }: puts on an item you own (or a kind's free one, taking the paid one off).
// Trusty's account is the house (utils/house.js) and can't shop.

const MAX_NAMES = 60;
const STYLE_SECONDS = 60;
const unwrap = (result) => (result && 'value' in result ? result.value : result);
const fmt = (n) => new Intl.NumberFormat('en-US').format(n);

function mine(doc) {
  const shop = (doc && doc.shop) || {};
  return {
    clicks: (doc && doc.clicks) || 0,
    owned: [...ownedSet(shop.owned)],
    equipped: equippedOf(shop),
    spent: Number.isSafeInteger(shop.spent) ? shop.spent : 0,
  };
}

// How these players' names look, by name.
async function styles(col, names) {
  const docs = await col.find(
    { username: { $in: names }, 'shop.equipped': { $exists: true } },
    { projection: { _id: 0, username: 1, 'shop.owned': 1, 'shop.equipped': 1 } }
  ).toArray();
  const out = {};
  for (const doc of docs) {
    const style = nameStyleOf(doc.shop);
    if (style && typeof doc.username === 'string') out[doc.username] = style;
  }
  return out;
}

export async function buy(col, user, item, now = new Date()) {
  const today = dayOf(now);
  // The first purchase of a new day starts the day's count from zero.
  await col.updateOne({ userId: user.userId, 'shop.day': { $ne: today } }, { $set: { 'shop.day': today, 'shop.today': 0 } });
  const done = unwrap(await col.findOneAndUpdate(
    { userId: user.userId, clicks: { $gte: item.price }, 'shop.owned': { $ne: item.id }, 'shop.day': today },
    {
      $inc: { clicks: -item.price, 'shop.spent': item.price, 'shop.today': item.price },
      $push: { 'shop.owned': item.id },
      $set: { [`shop.equipped.${item.kind}`]: item.id, 'shop.boughtAt': now },
    },
    { returnDocument: 'after', projection: { clicks: 1, shop: 1 } }
  ));
  if (done) return [200, { ...mine(done), bought: item.id }];

  // Why not?
  const doc = await col.findOne({ userId: user.userId }, { projection: { clicks: 1, shop: 1 } });
  if (!doc) return [400, { error: 'You don’t have any clicks yet: click Trusty at the top of the page to earn some.' }];
  if (ownedSet(doc.shop && doc.shop.owned).has(item.id)) return [409, { error: `You already have ${item.name}.`, ...mine(doc) }];
  const short = item.price - (doc.clicks || 0);
  if (short > 0) return [400, { error: `${item.name} costs ${fmt(item.price)} clicks: you need ${fmt(short)} more.`, ...mine(doc) }];
  return [409, { error: 'Something changed in the meantime. Try again?', ...mine(doc) }];
}

export async function equip(col, user, item) {
  const field = `shop.equipped.${item.kind}`;
  // A kind's free item just takes the paid one off.
  const result = isFree(item)
    ? await col.updateOne({ userId: user.userId }, { $unset: { [field]: '' } })
    : await col.updateOne({ userId: user.userId, 'shop.owned': item.id }, { $set: { [field]: item.id } });
  const doc = await col.findOne({ userId: user.userId }, { projection: { clicks: 1, shop: 1 } });
  if (!result.matchedCount && !isFree(item)) return [403, { error: `You don’t own ${item.name} yet.`, ...mine(doc) }];
  return [200, mine(doc)];
}

export default async function shop(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const db = await connectToDatabase();
    const col = db.collection('click_game');

    if (req.method === 'GET' && req.query.n != null) {
      const sent = [].concat(req.query.n);
      const names = [...new Set(sent.filter((n) => typeof n === 'string' && n && n.length <= 100))].slice(0, MAX_NAMES);
      const answer = { styles: names.length ? await styles(col, names) : {} };
      cachePublic(req, res, STYLE_SECONDS);
      return res.status(200).json(answer);
    }

    const login = authenticateUser(req);
    if (!login || login.userId == null) return res.status(401).json({ error: 'Log in to shop.' });
    const user = { ...login, userId: String(login.userId) };

    if (req.method === 'GET') {
      const doc = await col.findOne({ userId: user.userId }, { projection: { clicks: 1, shop: 1 } });
      return res.status(200).json({ ...mine(doc), house: isHouse(user.username), items: ITEMS.length });
    }
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    const order = cleanOrder(req.body);
    if (!order) return res.status(400).json({ error: 'That’s not something the shop sells.' });
    if (isHouse(user.username)) return res.status(403).json({ error: 'Trusty’s account is the house: it can’t shop.' });
    const [status, answer] = order.do === 'buy' ? await buy(col, user, order.item) : await equip(col, user, order.item);
    return res.status(status).json(answer);
  } catch (error) {
    console.error('Shop API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
