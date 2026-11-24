// Where the hunt (utils/hunt-game.js) keeps things: in MongoDB for the site (mongoHunt(db)), in memory for the
// tests and tools/dev-server.mjs (memoryHunt()). No database driver here, so the dev server can use it.
//   hunt:          the one hunt, `_id: 'hunt'` (what utils/hunt-rules.js's importHunt made, plus `firstFinder`).
//   hunt_progress: one document per player who got through the door: { userId, name, solved: [step ids],
//                  at: { [step id]: Date }, found: Date }.
//   hunt_codes:    one per card in the box: { _id: salted hash of the code, made, usedBy, usedName, usedAt }.
//                  `usedBy` is unique among used codes, so nobody can take two cards.
//   click_game:    the clicks it pays, with `huntPaid` (what's been paid for), changed in one update with them.
//   rate_limits:   the guess, geochecker and code limits (as utils/rate-limit.js keeps them).

const HUNT_CACHE_MS = 20000; // Trusty TV asks about every minute per viewer: no need to read the hunt every time

const unwrap = (result) => (result && 'value' in result ? result.value : result);

export function mongoHunt(db) {
  const hunts = db.collection('hunt');
  const progress = db.collection('hunt_progress');
  const codes = db.collection('hunt_codes');
  const clicks = db.collection('click_game');
  const limits = db.collection('rate_limits');
  let cached = null;
  let cachedAt = 0;
  // Made once; createIndex leaves an index that's already there alone.
  const ready = Promise.all([
    progress.createIndex({ userId: 1 }, { unique: true }),
    codes.createIndex({ usedBy: 1 }, { unique: true, partialFilterExpression: { usedBy: { $type: 'string' } } }),
    limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]).catch((error) => console.error('Hunt indexes failed:', error));

  const windowId = (key, windowMs, now) => `${key}:${windowMs}:${Math.floor(now / windowMs)}`;

  return {
    async hunt(fresh = false) {
      if (!fresh && cached && Date.now() - cachedAt < HUNT_CACHE_MS) return cached;
      cached = await hunts.findOne({ _id: 'hunt' }, { projection: { _id: 0 } });
      cachedAt = Date.now();
      return cached;
    },
    async saveHunt(doc) {
      await hunts.replaceOne({ _id: 'hunt' }, doc, { upsert: true });
      cached = null;
    },
    async claimFirst(name) {
      const won = await hunts.updateOne({ _id: 'hunt', firstFinder: null }, { $set: { firstFinder: name } });
      cached = null;
      return won.modifiedCount === 1;
    },
    progress: (userId) => progress.findOne({ userId }, { projection: { _id: 0 } }),
    async solve(userId, name, id, now) {
      await ready;
      try {
        const done = await progress.updateOne(
          { userId, solved: { $ne: id } },
          { $addToSet: { solved: id }, $set: { name, [`at.${id}`]: new Date(now) } },
          { upsert: true }
        );
        return done.modifiedCount === 1 || done.upsertedCount === 1;
      } catch (error) {
        if (error && error.code === 11000) return false; // already solved: the upsert hit their document
        throw error;
      }
    },
    async setFound(userId, now) { await progress.updateOne({ userId }, { $set: { found: new Date(now) } }); },
    async resetProgress(userId) { await progress.deleteOne({ userId }); },
    async stats() {
      const [solved, finders] = await Promise.all([
        progress.aggregate([{ $unwind: '$solved' }, { $group: { _id: '$solved', n: { $sum: 1 } } }]).toArray(),
        codes.find({ usedBy: { $type: 'string' } }, { projection: { _id: 0, usedName: 1 } }).sort({ usedAt: 1 }).limit(100).toArray(),
      ]);
      return { solved: Object.fromEntries(solved.map((s) => [s._id, s.n])), finders: finders.map((f) => f.usedName) };
    },
    async addCodes(hashes, now) {
      if (hashes.length) await codes.insertMany(hashes.map((hash) => ({ _id: hash, made: new Date(now), usedBy: null })));
    },
    async voidCodes() { await codes.deleteMany({ usedBy: null }); },
    async codeCounts() {
      const [total, used] = await Promise.all([codes.countDocuments({}), codes.countDocuments({ usedBy: { $type: 'string' } })]);
      return { total, used };
    },
    // 'ok', 'used' (someone took that card), 'none' (no such code) or 'mine' (this player already took one).
    async claimCode(hash, userId, name, now) {
      await ready;
      try {
        const taken = unwrap(await codes.findOneAndUpdate(
          { _id: hash, usedBy: null },
          { $set: { usedBy: userId, usedName: name, usedAt: new Date(now) } }
        ));
        if (taken) return 'ok';
      } catch (error) {
        if (error && error.code === 11000) return 'mine';
        throw error;
      }
      return (await codes.findOne({ _id: hash }, { projection: { _id: 1 } })) ? 'used' : 'none';
    },
    async releaseCode(hash) { await codes.updateOne({ _id: hash }, { $set: { usedBy: null }, $unset: { usedName: '', usedAt: '' } }); },
    // Pays `amount` clicks once per `key` per account: the clicks and the note that they're paid go in together.
    async pay(userId, name, key, amount) {
      const fields = { projection: { clicks: 1 } };
      const after = unwrap(await clicks.findOneAndUpdate(
        { userId, huntPaid: { $ne: key } },
        { $inc: { clicks: amount }, $set: { username: name }, $push: { huntPaid: key } },
        { ...fields, returnDocument: 'after' }
      ));
      if (after) return { added: amount, clicks: after.clicks };
      // No match: this account has never clicked, or it's been paid for this already.
      const inserted = await clicks.updateOne(
        { userId },
        { $setOnInsert: { clicks: amount, username: name, recent: [], huntPaid: [key] } },
        { upsert: true }
      );
      const doc = await clicks.findOne({ userId }, fields);
      return { added: inserted.upsertedCount ? amount : 0, clicks: (doc && doc.clicks) || 0 };
    },
    async count(key, windowMs, now) {
      const doc = await limits.findOne({ _id: windowId(key, windowMs, now) }, { projection: { n: 1 } });
      return (doc && doc.n) || 0;
    },
    async hit(key, windowMs, now) {
      const window = Math.floor(now / windowMs);
      await limits.updateOne(
        { _id: windowId(key, windowMs, now) },
        { $inc: { n: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowMs) } },
        { upsert: true }
      );
    },
  };
}

// The same, in memory. `bank` is the dev server's pretend click bank (tools/mock-bank.mjs), if there is one.
export function memoryHunt({ bank = null } = {}) {
  let hunt = null;
  const progress = new Map();
  const codes = new Map();
  const paid = new Map();
  const counts = new Map();
  const clicks = new Map();
  const balance = (userId) => (bank ? bank.account(userId) : (clicks.has(userId) || clicks.set(userId, { clicks: 0 }), clicks.get(userId)));
  const windowId = (key, windowMs, now) => `${key}:${windowMs}:${Math.floor(now / windowMs)}`;
  return {
    async hunt() { return hunt && structuredClone(hunt); },
    async saveHunt(doc) { hunt = structuredClone(doc); },
    async claimFirst(name) {
      if (!hunt || hunt.firstFinder) return false;
      hunt.firstFinder = name;
      return true;
    },
    async progress(userId) { return progress.has(userId) ? structuredClone(progress.get(userId)) : null; },
    async solve(userId, name, id, now) {
      const doc = progress.get(userId) || { userId, name, solved: [], at: {} };
      progress.set(userId, doc);
      doc.name = name;
      if (doc.solved.includes(id)) return false;
      doc.solved.push(id);
      doc.at[id] = new Date(now);
      return true;
    },
    async setFound(userId, now) { if (progress.has(userId)) progress.get(userId).found = new Date(now); },
    async resetProgress(userId) { progress.delete(userId); },
    async stats() {
      const solved = {};
      for (const doc of progress.values()) for (const id of doc.solved) solved[id] = (solved[id] || 0) + 1;
      const finders = [...codes.values()].filter((c) => c.usedBy).sort((a, b) => a.usedAt - b.usedAt).map((c) => c.usedName);
      return { solved, finders };
    },
    async addCodes(hashes, now) { for (const hash of hashes) codes.set(hash, { made: new Date(now), usedBy: null }); },
    async voidCodes() { for (const [hash, c] of codes) if (!c.usedBy) codes.delete(hash); },
    async codeCounts() { return { total: codes.size, used: [...codes.values()].filter((c) => c.usedBy).length }; },
    async claimCode(hash, userId, name, now) {
      const code = codes.get(hash);
      if (!code) return 'none';
      if (code.usedBy) return 'used';
      if ([...codes.values()].some((c) => c.usedBy === userId)) return 'mine';
      Object.assign(code, { usedBy: userId, usedName: name, usedAt: now });
      return 'ok';
    },
    async releaseCode(hash) { if (codes.has(hash)) codes.set(hash, { ...codes.get(hash), usedBy: null }); },
    async pay(userId, name, key, amount) {
      if (!paid.has(userId)) paid.set(userId, new Set());
      const account = balance(userId);
      if (paid.get(userId).has(key)) return { added: 0, clicks: account.clicks };
      paid.get(userId).add(key);
      account.clicks += amount;
      return { added: amount, clicks: account.clicks };
    },
    async count(key, windowMs, now) { return counts.get(windowId(key, windowMs, now)) || 0; },
    async hit(key, windowMs, now) {
      const id = windowId(key, windowMs, now);
      counts.set(id, (counts.get(id) || 0) + 1);
    },
  };
}
