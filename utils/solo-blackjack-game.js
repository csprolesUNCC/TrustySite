import { memoryGames, defaults } from './solo-store.js';
import {
  newShoe, deal, insure, insuranceCost, hit, stand, double, split, canDouble, canSplit, raiseCost, dealerStep,
  payouts, view, isBet, BETS, RESHUFFLE_BELOW,
} from '../scripts/blackjack.js';

// The solo Trusty Blackjack game itself (utils/solo-blackjack.js serves it), with no database here, so
// tools/dev-server.mjs and the tests play exactly the same game with games kept in memory (memoryGames()).

// A hand left alone this long is stood and settled on the next visit. The bank never gives solo bets back by
// itself (refundStale() skips them), so walking away from a bad hand doesn't get the bet back.
export const STALE_HAND_MS = 60 * 60 * 1000;
const MOVES = ['deal', 'insure', 'hit', 'stand', 'double', 'split'];

const fresh = () => ({ v: 0, shoe: null, round: null, hand: 0, shuffled: false, at: null, settled: true });

// What a request's body asks for, or null.
export function cleanMove(body) {
  if (!body || typeof body !== 'object' || !MOVES.includes(body.do)) return null;
  if (body.do === 'deal') return isBet(body.amount) ? { do: 'deal', amount: body.amount } : null;
  if (body.do === 'insure') return { do: 'insure', take: body.take === true };
  return { do: body.do };
}

function reply(doc, extra = {}) {
  const shown = doc.round && view(doc.round);
  return {
    hand: doc.hand,
    shuffled: doc.shuffled,
    round: shown && { ...shown, seats: shown.seats.map(({ id, ...seat }) => ({ ...seat, you: true })) },
    bets: BETS,
    ...extra,
  };
}

// Nobody's coming back to this hand: stand everything and let Trusty finish.
function playOut(round) {
  if (round.phase === 'insurance') round.seats.forEach((s, i) => { if (!s.decided) insure(round, i, null); });
  while (round.phase === 'player') stand(round);
  while (dealerStep(round));
}

async function load(deps, userId) {
  const doc = (await deps.load(userId)) || fresh();
  if (doc.round) doc.round.shoe = doc.shoe;
  return doc;
}

async function save(deps, userId, doc) {
  const { shoe, ...round } = doc.round || {};
  const ok = await deps.save(userId, { ...doc, round: doc.round ? round : null, v: doc.v + 1 }, doc.v);
  if (ok) doc.v += 1;
  return ok;
}

// Pays out a finished hand (again, if a payout didn't get through: the bank only pays each bet once).
async function settleHand(deps, userId, doc) {
  if (!doc.round || doc.round.phase !== 'over' || doc.settled) return null;
  const bets = payouts(doc.round).map(({ id, payout }) => ({ userId, betId: id, payout }));
  const answer = await deps.bank.settle(bets);
  doc.settled = true;
  await save(deps, userId, doc); // if another tab beat us to it, the next visit settles again, harmlessly
  return (answer && answer.balances && answer.balances[userId]) || null;
}

// deps: { load(userId), save(userId, doc, v) (false if the stored version isn't v any more), bank: { stake,
// settle } as in utils/bank.js or tools/mock-bank.mjs, now(), random(), newId() }. move: from cleanMove(), or
// null to just look. Returns what the page gets.
export async function play(deps, userId, move) {
  let doc = await load(deps, userId);
  if (doc.round && doc.round.phase !== 'over' && deps.now() - doc.at > STALE_HAND_MS) {
    playOut(doc.round);
    doc.settled = false;
    if (!(await save(deps, userId, doc))) doc = await load(deps, userId);
  }
  let bank = await settleHand(deps, userId, doc);
  if (!move) return reply(doc, { bank });

  const r = doc.round;
  const playing = r && r.phase !== 'over';
  const no = (error) => reply(doc, { bank, error });
  let staked = null;
  const charge = async (amount) => {
    const id = deps.newId();
    const answer = await deps.bank.stake({ userId, betId: id, amount, game: 'blackjack', solo: true });
    if (!answer.ok) return answer.error;
    staked = { id, amount };
    bank = { clicks: answer.clicks, net: answer.net };
    return null;
  };

  if (move.do === 'deal') {
    if (playing) return no('Finish this hand first.');
    const problem = await charge(move.amount);
    if (problem) return no(problem);
    doc.shuffled = !doc.shoe || doc.shoe.length < RESHUFFLE_BELOW;
    if (doc.shuffled) doc.shoe = newShoe(deps.random);
    doc.round = deal(doc.shoe, [{ id: userId, stake: staked }]);
    doc.hand += 1;
    doc.at = deps.now();
  } else if (move.do === 'insure') {
    if (!playing || r.phase !== 'insurance') return no('Nobody’s asking about insurance.');
    if (move.take) {
      const problem = await charge(insuranceCost(r, 0));
      if (problem) return no(problem);
    }
    insure(r, 0, staked);
  } else if (!playing || r.phase !== 'player') {
    return no('It’s not your turn.');
  } else if (move.do === 'hit') {
    hit(r);
  } else if (move.do === 'stand') {
    stand(r);
  } else {
    if (!(move.do === 'double' ? canDouble(r) : canSplit(r))) return no(`You can’t ${move.do} this hand.`);
    const problem = await charge(raiseCost(r));
    if (problem) return no(problem);
    if (move.do === 'double') double(r, staked);
    else split(r, staked);
  }
  if (doc.round.phase === 'dealer') while (dealerStep(doc.round));
  doc.settled = false;

  if (!(await save(deps, userId, doc))) {
    // Another tab moved first: give this move's stake back and show the game as it is.
    if (staked) {
      const back = await deps.bank.settle([{ userId, betId: staked.id, payout: staked.amount }]);
      bank = (back && back.balances && back.balances[userId]) || bank;
    }
    return reply(await load(deps, userId), { bank, error: 'That hand moved on in another tab.' });
  }
  bank = (await settleHand(deps, userId, doc)) || bank;
  return reply(doc, { bank });
}

// Games in memory (tests, tools/dev-server.mjs) and real randomness: see utils/solo-store.js.
export { memoryGames, defaults };
