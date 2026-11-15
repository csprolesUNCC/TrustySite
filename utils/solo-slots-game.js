import { BETS, MACHINES, isMachine, isBet, spin, lineOf, payFor } from '../scripts/slots.js';
import { memoryGames, defaults } from './solo-store.js';

// The Trusty Slots game itself (utils/solo-slots.js serves it), with no database here, so tools/dev-server.mjs and
// the tests play exactly the same game with games kept in memory (memoryGames() from utils/solo-store.js).
//
// One move: bet and spin. The bet is staked at the click bank first (nothing spins if the bank says no), then the
// reels stop where the server's dice put them, and what the spin pays is written down (`pending`) in the same save
// as the spin, then settled at the bank; a payout that didn't get through is retried on the next request (the bank
// only pays a bet once). The page never decides anything: it gets the stops and draws them.

const fresh = () => ({ v: 0, spins: 0, last: null, pending: [] });

// What a request's body asks for, or null: { do: 'spin', machine, amount }.
export function cleanMove(body) {
  if (!body || typeof body !== 'object' || body.do !== 'spin') return null;
  if (!isMachine(body.machine) || !isBet(body.amount)) return null;
  return { do: 'spin', machine: body.machine, amount: body.amount };
}

const reply = (doc, extra = {}) => ({ last: doc.last, spins: doc.spins, bets: BETS, ...extra });

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
// settle } as in utils/bank.js or tools/mock-bank.mjs, now(), random(), newId() }. move: from cleanMove(), or
// null to just look. Returns what the page gets: { last: { machine, stops, line, amount, times, kind, symbol,
// payout, at } | null, spins, bets, bank: { clicks, net } | null, error? }.
export async function play(deps, userId, move) {
  const doc = (await deps.load(userId)) || fresh();
  let bank = await settlePending(deps, userId, doc);
  if (!move) return reply(doc, { bank });

  const id = deps.newId();
  const staked = await deps.bank.stake({ userId, betId: id, amount: move.amount, game: 'slots', solo: true });
  if (!staked.ok) return reply(doc, { bank, error: staked.error });
  bank = { clicks: staked.clicks, net: staked.net };

  const machine = MACHINES[move.machine];
  const stops = spin(machine, deps.random);
  const line = lineOf(machine, stops);
  const pay = payFor(machine, line);
  const payout = move.amount * pay.times;
  doc.spins += 1;
  doc.last = { machine: machine.key, stops, line, amount: move.amount, times: pay.times, kind: pay.kind, symbol: pay.symbol, payout, at: deps.now() };
  doc.pending = [{ betId: id, payout }];

  if (!(await save(deps, userId, doc))) {
    // Another tab spun first: this spin never happened, so its bet goes back.
    const back = await deps.bank.settle([{ userId, betId: id, payout: move.amount }]);
    bank = (back && back.balances && back.balances[userId]) || bank;
    return reply((await deps.load(userId)) || fresh(), { bank, error: 'The reels were spun in another tab.' });
  }
  bank = (await settlePending(deps, userId, doc)) || bank;
  return reply(doc, { bank });
}

export { memoryGames, defaults };
