import { randomBytes, randomInt } from 'node:crypto';

// Where the one-player casino games (utils/solo-blackjack.js, utils/solo-craps.js) keep each account's game: one
// document per account, with a version `v` so a move from a second tab can't overwrite the first one's. In MongoDB
// for the site (mongoGames()), in memory for the tests and tools/dev-server.mjs (memoryGames()). No database
// driver here, so the dev server can use it.

const KEEP_DAYS = 30; // a game nobody's touched for this long is deleted (a new shoe, an empty table next time)

const indexed = new Map(); // collection name -> the TTL index being made
export function mongoGames(col) {
  if (!indexed.has(col.collectionName)) {
    indexed.set(col.collectionName, col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => indexed.delete(col.collectionName)));
  }
  return {
    load: (userId) => col.findOne({ _id: userId }, { projection: { _id: 0, expiresAt: 0 } }),
    async save(userId, doc, v) {
      const expiresAt = new Date(Date.now() + KEEP_DAYS * 864e5);
      try {
        const result = await col.updateOne({ _id: userId, v }, { $set: { ...doc, expiresAt } }, { upsert: v === 0 });
        return result.matchedCount === 1 || result.upsertedCount === 1;
      } catch (error) {
        if (error && error.code === 11000) return false; // a first game, started in two tabs at once
        throw error;
      }
    },
  };
}

// Games kept in memory. Both store copies, so a game only changes when it's saved.
export function memoryGames() {
  const games = new Map();
  return {
    games,
    async load(userId) { return games.has(userId) ? structuredClone(games.get(userId)) : null; },
    async save(userId, doc, v) {
      if ((games.has(userId) ? games.get(userId).v : 0) !== v) return false;
      games.set(userId, structuredClone(doc));
      return true;
    },
  };
}

// Real randomness: nobody sees the shoe or the dice coming, but there's no point making them guessable either.
export const defaults = {
  now: Date.now,
  random: () => randomInt(2 ** 32) / 2 ** 32,
  newId: () => randomBytes(8).toString('hex'),
};
