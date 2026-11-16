import { BETS, isBet, jackpotChance, play as spinMachine } from '../scripts/slots.js';
import { memoryGames, defaults } from './solo-store.js';

// The Trusty Slots game itself (utils/solo-slots.js serves it), with no database here, so tools/dev-server.mjs and
// the tests play exactly the same game with games kept in memory (memoryGames() from utils/solo-store.js).
//
// One move: bet and spin. The bet is staked at the click bank first (nothing spins if the bank says no), then the
// reels stop where the server's dice put them. A spin that wins the Golden Horse bonus has all its free spins
// decided right then too, so the whole thing is one bet and one payout: the page plays the free spins out
// afterwards, but they're already settled. What the spin pays is written down (`pending`) in the same save as the
// spin, then settled at the bank; a payout that didn't get through is retried on the next request (the bank
// only pays a bet once). The page never decides anything: it gets the stops and draws them.

// The Grand Jackpot (JACKPOT in scripts/slots.js, kept by utils/slots-jackpot.js): after the reels are decided the
// spin gets one more roll, for the pot the whole site's spins have built up. A win takes all of it, paid with the
// spin; either way the spin's own share then goes into the pot. A pot that can't be reached never stops a spin:
// it just can't be won or added to that time.

const fresh = () => ({ v: 0, spins: 0, last: null, pending: [] });

// What a request's body asks for, or null: { do: 'spin', amount }.
export function cleanMove(body) {
  if (!body || typeof body !== 'object' || body.do !== 'spin' || !isBet(body.amount)) return null;
  return { do: 'spin', amount: body.amount };
}

const reply = (doc, extra = {}) => ({ last: doc.last, spins: doc.spins, bets: BETS, ...extra });

// The pot's own storage failing isn't worth losing a spin over.
async function pot(deps, what, ...args) {
  try {
    return await deps.jackpot[what](...args);
  } catch (error) {
    console.error(`Slots jackpot (${what}):`, error);
    return null;
  }
}

async function save(deps, userId, doc) {
  const ok = await deps.save(userId, { ...doc, v: doc.v + 1 }, doc.v);
  if (ok) doc.v += 1;
  return ok;
}

// Pays out the last spin (again, if its payout didn't get through: the bank only pays each bet once).
async function settlePending(deps, userId, doc) {
  if (!doc.pending || !doc.pending.length) return null;
  const answer = await deps.bank.settle(doc.pending.map(({ betId, payout }) => ({ userId, betId, payout })));
  doc.pending = [];
  await save(deps, userId, doc); // if another tab beat us to it, the next visit settles again, harmlessly
  return (answer && answer.balances && answer.balances[userId]) || null;
}

// deps: { load(userId), save(userId, doc, v) (false if the stored version isn't v any more), bank: { stake,
// settle } as in utils/bank.js or tools/mock-bank.mjs, jackpot: { peek, add, claim, giveBack } as in
// utils/slots-jackpot.js, now(), random(), newId(), and optionally luck() (the jackpot's roll, random() otherwise) }.
// move: from cleanMove(), or null to just look. Returns what the page gets: { last: { stops, line, times, kind,
// symbol, bonus (null, or the free spins: { spins: [{ stops, line, times, kind, symbol }], times }), total, amount,
// jackpot (the clicks of Grand Jackpot it won, usually 0), payout, at } | null, spins, bets, jackpot (the pot now,
// or null if it couldn't be read), bank: { clicks, net } | null, error? }. The times are multiples of the bet;
// payout and jackpot are clicks.
export async function play(deps, userId, move) {
  const doc = (await deps.load(userId)) || fresh();
  let bank = await settlePending(deps, userId, doc);
  if (!move) return reply(doc, { bank, jackpot: await pot(deps, 'peek') });

  const id = deps.newId();
  const staked = await deps.bank.stake({ userId, betId: id, amount: move.amount, game: 'slots', solo: true });
  if (!staked.ok) return reply(doc, { bank, jackpot: await pot(deps, 'peek'), error: staked.error });
  bank = { clicks: staked.clicks, net: staked.net };

  const spun = spinMachine(deps.random);
  const lucky = (deps.luck || deps.random)() < jackpotChance(move.amount);
  const jackpot = lucky ? (await pot(deps, 'claim')) || 0 : 0;
  const payout = move.amount * spun.total + jackpot;
  doc.spins += 1;
  doc.last = { ...spun, amount: move.amount, jackpot, payout, at: deps.now() };
  doc.pending = [{ betId: id, payout }];

  if (!(await save(deps, userId, doc))) {
    // Another tab spun first: this spin never happened, so its bet goes back (and the pot, if it had won it).
    if (jackpot) await pot(deps, 'giveBack', jackpot);
    const back = await deps.bank.settle([{ userId, betId: id, payout: move.amount }]);
    bank = (back && back.balances && back.balances[userId]) || bank;
    return reply((await deps.load(userId)) || fresh(), { bank, jackpot: await pot(deps, 'peek'), error: 'The reels were spun in another tab.' });
  }
  bank = (await settlePending(deps, userId, doc)) || bank;
  return reply(doc, { bank, jackpot: await pot(deps, 'add', move.amount) });
}

export { memoryGames, defaults };
