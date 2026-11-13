import { SPOTS, BETS, ODDS_TIMES, newTable, roll, cleanBets, betProblem } from '../scripts/craps.js';
import { memoryGames, defaults } from './solo-store.js';

// The Trusty Craps game itself (utils/solo-craps.js serves it), with no database here, so tools/dev-server.mjs and
// the tests play exactly the same game with games kept in memory (memoryGames() from utils/solo-store.js).
//
// One move: put down this roll's new bets and roll. Every new bet is staked at the click bank first; if one can't
// be (not enough clicks, the daily limit), the others go back and nothing is rolled. Bets the roll decides are
// written down (`pending`) in the same save as the roll, then settled at the bank; a payout that didn't get through
// is retried on the next request (the bank only pays a bet once). Pass Line, Don't Pass and Odds stay on the table
// between rolls, as long as it takes: the bank never gives solo bets back by itself.

const HISTORY = 20; // recent rolls shown along the table's edge

const fresh = () => ({ v: 0, table: newTable(), rolls: 0, history: [], last: null, pending: [] });

// What a request's body asks for, or null: { do: 'roll', bets: { [spot]: amount } } (bets may be empty, for a
// roll with only what's already on the table).
export function cleanMove(body) {
  if (!body || typeof body !== 'object' || body.do !== 'roll') return null;
  const bets = cleanBets(body.bets);
  return bets && { do: 'roll', bets };
}

function reply(doc, extra = {}) {
  return {
    table: { point: doc.table.point, bets: Object.fromEntries(Object.entries(doc.table.bets).map(([spot, b]) => [spot, b.amount])) },
    last: doc.last,
    history: doc.history,
    rolls: doc.rolls,
    bets: BETS,
    oddsTimes: ODDS_TIMES,
    ...extra,
  };
}

async function save(deps, userId, doc) {
  const ok = await deps.save(userId, { ...doc, v: doc.v + 1 }, doc.v);
  if (ok) doc.v += 1;
  return ok;
}

// Pays out what the last roll decided (again, if a payout didn't get through: the bank only pays each bet once).
async function settlePending(deps, userId, doc) {
  if (!doc.pending || !doc.pending.length) return null;
  const answer = await deps.bank.settle(doc.pending.map(({ betId, payout }) => ({ userId, betId, payout })));
  doc.pending = [];
  await save(deps, userId, doc); // if another tab beat us to it, the next visit settles again, harmlessly
  return (answer && answer.balances && answer.balances[userId]) || null;
}

const die = (random) => 1 + Math.floor(random() * 6);

// deps: { load(userId), save(userId, doc, v) (false if the stored version isn't v any more), bank: { stake,
// settle } as in utils/bank.js or tools/mock-bank.mjs, now(), random(), newId() }. move: from cleanMove(), or
// null to just look. Returns what the page gets.
export async function play(deps, userId, move) {
  const doc = (await deps.load(userId)) || fresh();
  let bank = await settlePending(deps, userId, doc);
  if (!move) return reply(doc, { bank });

  const no = (error) => reply(doc, { bank, error });
  const problem = betProblem(doc.table, move.bets)
    || (!Object.keys(move.bets).length && !Object.keys(doc.table.bets).length ? 'Put a bet down first.' : null);
  if (problem) return no(problem);

  // Stake every new bet, or none.
  const staked = [];
  const giveBack = async () => {
    if (!staked.length) return;
    const back = await deps.bank.settle(staked.map((s) => ({ userId, betId: s.id, payout: s.amount })));
    bank = (back && back.balances && back.balances[userId]) || bank;
  };
  for (const spot of SPOTS) {
    const amount = move.bets[spot];
    if (!amount) continue;
    const id = deps.newId();
    const answer = await deps.bank.stake({ userId, betId: id, amount, game: 'craps', solo: true });
    if (!answer.ok) {
      await giveBack();
      return no(answer.error);
    }
    staked.push({ spot, id, amount });
    bank = { clicks: answer.clicks, net: answer.net };
  }
  for (const { spot, id, amount } of staked) doc.table.bets[spot] = { id, amount };

  const point = doc.table.point;
  const dice = [die(deps.random), die(deps.random)];
  const decided = roll(doc.table, dice);
  doc.rolls += 1;
  doc.history = [...doc.history, dice[0] + dice[1]].slice(-HISTORY);
  doc.last = { dice, point, at: deps.now(), decided: decided.map(({ spot, amount, result, payout }) => ({ spot, amount, result, payout })) };
  doc.pending = decided.map(({ id, payout }) => ({ betId: id, payout }));

  if (!(await save(deps, userId, doc))) {
    // Another tab rolled first: give this roll's new bets back and show the table as it is.
    await giveBack();
    return reply((await deps.load(userId)) || fresh(), { bank, error: 'The dice were rolled in another tab.' });
  }
  bank = (await settlePending(deps, userId, doc)) || bank;
  return reply(doc, { bank });
}

export { memoryGames, defaults };
