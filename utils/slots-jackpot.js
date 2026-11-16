import { JACKPOT } from '../scripts/slots.js';

// Where Trusty Slots' Grand Jackpot is kept: one pot for the whole site, which every player's spins build up and
// one spin wins (the rules and the numbers are JACKPOT in scripts/slots.js; utils/solo-slots-game.js plays them).
// In MongoDB for the site (mongoJackpot(): one document, `_id: 'pot'`, in `slots_jackpot`), in memory for the
// tests and tools/dev-server.mjs (memoryJackpot()). No database driver here, so the dev server can use it.
//
// The pot is kept in hundredths of a click, so a 10-click bet's 2% is a whole number; everything going in or out
// of here is in clicks, and a win pays whole ones. Every change is one atomic update: two spins at once can't
// both win the same pot (the second one gets the new pot, back at the seed).
//   peek(): the pot now, in clicks.
//   add(amount): a spin of `amount` clicks was made: its share goes in (up to JACKPOT.max). Returns the pot.
//   claim(): takes the whole pot and starts a new one from the seed. Returns the clicks won.
//   giveBack(clicks): a win that didn't happen after all (its spin lost a race): the pot goes back.

const SEED = JACKPOT.seed * 100;
const MAX = JACKPOT.max * 100;
const share = (amount) => Math.round(amount * JACKPOT.rate * 100);
const clicks = (cents) => Math.floor(cents / 100);
const unwrap = (result) => (result && 'value' in result ? result.value : result);

export function memoryJackpot() {
  const pot = { cents: SEED, wins: 0 };
  return {
    pot,
    async peek() { return clicks(pot.cents); },
    async add(amount) {
      pot.cents = Math.min(MAX, pot.cents + share(amount));
      return clicks(pot.cents);
    },
    async claim() {
      const won = clicks(pot.cents);
      pot.cents = SEED;
      pot.wins += 1;
      return won;
    },
    async giveBack(amount) { pot.cents = Math.min(MAX, pot.cents - SEED + amount * 100); },
  };
}

export function mongoJackpot(col) {
  const now = { $ifNull: ['$cents', SEED] }; // no pot yet: it starts at the seed
  return {
    async peek() {
      const doc = await col.findOne({ _id: 'pot' }, { projection: { cents: 1 } });
      return clicks(doc && Number.isFinite(doc.cents) ? doc.cents : SEED);
    },
    async add(amount) {
      const doc = unwrap(await col.findOneAndUpdate(
        { _id: 'pot' },
        [{ $set: { cents: { $min: [MAX, { $add: [now, share(amount)] }] } } }],
        { upsert: true, returnDocument: 'after', projection: { cents: 1 } },
      ));
      return clicks(doc && Number.isFinite(doc.cents) ? doc.cents : SEED);
    },
    async claim() {
      const before = unwrap(await col.findOneAndUpdate(
        { _id: 'pot' },
        [{ $set: { cents: SEED, wins: { $add: [{ $ifNull: ['$wins', 0] }, 1] }, wonAt: '$$NOW' } }],
        { upsert: true, returnDocument: 'before', projection: { cents: 1 } },
      ));
      return clicks(before && Number.isFinite(before.cents) ? before.cents : SEED);
    },
    async giveBack(amount) {
      await col.updateOne({ _id: 'pot' }, [{ $set: { cents: { $min: [MAX, { $add: [{ $subtract: [now, SEED] }, amount * 100] }] } } }]);
    },
  };
}
