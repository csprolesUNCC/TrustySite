// Trusty Blackjack's rules, with no drawing or timing code. The room server (realtime/table.js) deals the online
// tables with them, and utils/solo-blackjack.js deals the solo game (one player, on the site's API). House
// rules: six decks, a new shoe once three quarters are dealt, Trusty stands on all 17s and peeks for blackjack
// with an Ace or a 10 showing, blackjack pays 3 to 2, double on any two cards (after a split too), split pairs
// into up to four hands (split Aces get one card each), insurance pays 2 to 1.
//
// A round is plain data that the functions below change. Every bet in it is a stake { id, amount }, so the
// table can tell the bank exactly what each one paid (payouts()).

export const DECKS = 6;
export const RESHUFFLE_BELOW = (52 * DECKS) / 4;
export const MAX_HANDS = 4;
export const DEALER_STANDS_ON = 17;
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// Bump this whenever a table message (realtime/table.js) changes shape: a page and a room server that don't
// match then refuse each other with "reload".
export const TABLE_PROTOCOL = 1;
// Bets go up in tens, so 3:2 and insurance always come out in whole clicks. The click bank caps any bet at 500
// too. Online tables and the solo game (utils/solo-blackjack.js) both take these.
export const BETS = { min: 10, max: 500, step: 10 };
export const isBet = (amount) => Number.isInteger(amount) && amount >= BETS.min && amount <= BETS.max && amount % BETS.step === 0;

// What each kind of finished hand gives back, as a multiple of what was bet on it.
const PAYS = { blackjack: 2.5, win: 2, push: 1, lose: 0, bust: 0 };

export function newShoe(random = Math.random) {
  const shoe = [];
  for (let d = 0; d < DECKS; d++) for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

export const cardValue = (card) => (card.rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank));

// Best total, and whether an Ace is still being counted as 11.
export function total(cards) {
  let sum = 0;
  let aces = 0;
  for (const card of cards) {
    sum += cardValue(card);
    if (card.rank === 'A') aces++;
  }
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces--;
  }
  return { value: sum, soft: aces > 0 };
}

export const isNatural = (cards) => cards.length === 2 && total(cards).value === 21;

export function describe(cards, fromSplit = false) {
  if (!cards.length) return '';
  const { value, soft } = total(cards);
  if (!fromSplit && isNatural(cards)) return 'Blackjack';
  if (soft && value < 21) return `${value - 10} / ${value}`;
  return String(value);
}

/* ---------- A round at a table ---------- */

const newHand = (cards, stake, fromSplit = false, splitAces = false) => ({ cards, stakes: [stake], fromSplit, splitAces, done: false, result: null });
export const handBet = (hand) => hand.stakes.reduce((sum, s) => sum + s.amount, 0);

// seats: [{ id, stake: { id, amount } }] in the order they play. Deals two cards each and two to Trusty, then
// either asks about insurance (Trusty shows an Ace) or goes straight on to the first hand.
export function deal(shoe, seats) {
  const round = {
    shoe,
    dealer: [],
    holeHidden: true,
    dealerBlackjack: false,
    seats: seats.map((s) => ({ id: s.id, hands: [newHand([], s.stake)], insurance: null, decided: false })),
    phase: 'insurance', // insurance | player | dealer | over
    turn: -1,           // which seat is playing
    active: 0,          // which of its hands
  };
  for (const seat of round.seats) seat.hands[0].cards.push(shoe.pop());
  round.dealer.push(shoe.pop());
  for (const seat of round.seats) seat.hands[0].cards.push(shoe.pop());
  round.dealer.push(shoe.pop());
  if (round.dealer[0].rank !== 'A') afterInsurance(round);
  return round;
}

// What insurance (or even money, with a blackjack) costs a seat: half its bet.
export const insuranceCost = (round, i) => handBet(round.seats[i].hands[0]) / 2;

// A seat's answer to the insurance question: its stake, or null for no thanks. Once everyone has answered,
// Trusty peeks.
export function insure(round, i, stake) {
  const seat = round.seats[i];
  if (round.phase !== 'insurance' || !seat || seat.decided) return false;
  seat.decided = true;
  seat.insurance = stake || null;
  if (round.seats.every((s) => s.decided)) afterInsurance(round);
  return true;
}

// With an Ace or a 10 showing, Trusty peeks at his hole card: his blackjack ends the round at once. Otherwise
// every blackjack is paid now and play starts with the first hand.
function afterInsurance(round) {
  const up = round.dealer[0];
  if ((up.rank === 'A' || cardValue(up) === 10) && isNatural(round.dealer)) {
    round.dealerBlackjack = true;
    round.holeHidden = false;
    for (const seat of round.seats) {
      const hand = seat.hands[0];
      hand.done = true;
      hand.result = isNatural(hand.cards) ? 'push' : 'lose';
    }
    round.phase = 'over';
    return;
  }
  for (const seat of round.seats) {
    const hand = seat.hands[0];
    if (isNatural(hand.cards)) {
      hand.done = true;
      hand.result = 'blackjack';
    }
  }
  round.phase = 'player';
  round.turn = 0;
  round.active = 0;
  advance(round);
}

export const current = (round) => (round.phase === 'player' ? round.seats[round.turn].hands[round.active] : null);

// From the hand that's up, on to the next one that still needs playing (a split hand gets its second card
// when it's reached), or to Trusty once every hand is done.
function advance(round) {
  for (let t = round.turn; t < round.seats.length; t++) {
    const hands = round.seats[t].hands;
    for (let a = t === round.turn ? round.active : 0; a < hands.length; a++) {
      const hand = hands[a];
      if (!hand.done && hand.cards.length === 1) {
        hand.cards.push(round.shoe.pop());
        if (total(hand.cards).value === 21) hand.done = true; // 21 stands by itself
      }
      if (!hand.done) {
        round.turn = t;
        round.active = a;
        return;
      }
    }
  }
  round.turn = -1;
  round.active = 0;
  round.phase = 'dealer';
  round.holeHidden = false;
}

export function hit(round) {
  const hand = current(round);
  if (!hand) return false;
  hand.cards.push(round.shoe.pop());
  const { value } = total(hand.cards);
  if (value > 21) hand.result = 'bust';
  if (value >= 21) {
    hand.done = true;
    advance(round);
  }
  return true;
}

export function stand(round) {
  const hand = current(round);
  if (!hand) return false;
  hand.done = true;
  advance(round);
  return true;
}

export function canDouble(round) {
  const hand = current(round);
  return Boolean(hand) && hand.cards.length === 2 && !hand.splitAces;
}

export function canSplit(round) {
  const hand = current(round);
  return Boolean(hand) && hand.cards.length === 2 && !hand.splitAces && round.seats[round.turn].hands.length < MAX_HANDS
    && cardValue(hand.cards[0]) === cardValue(hand.cards[1]);
}

// What the hand that's up costs to double or to split: the same again.
export const raiseCost = (round) => handBet(current(round));

// Doubling adds `stake` (the same as the hand's bet) and takes exactly one more card.
export function double(round, stake) {
  if (!canDouble(round)) return false;
  const hand = current(round);
  hand.stakes.push(stake);
  hand.cards.push(round.shoe.pop());
  if (total(hand.cards).value > 21) hand.result = 'bust';
  hand.done = true;
  advance(round);
  return true;
}

// Splitting makes a second hand with `stake` (the same as the hand's bet). Split Aces get one card each.
export function split(round, stake) {
  if (!canSplit(round)) return false;
  const seat = round.seats[round.turn];
  const hand = current(round);
  const aces = hand.cards[0].rank === 'A';
  const second = newHand([hand.cards.pop()], stake, true, aces);
  hand.fromSplit = true;
  hand.splitAces = aces;
  seat.hands.splice(round.active + 1, 0, second);
  hand.cards.push(round.shoe.pop());
  if (aces) {
    second.cards.push(round.shoe.pop());
    hand.done = true;
    second.done = true;
  } else if (total(hand.cards).value === 21) {
    hand.done = true;
  }
  if (hand.done) advance(round);
  return true;
}

// Trusty's turn, a card at a time: true while he drew one, false once he's done and every hand is settled.
// He only draws if someone is still waiting on him (not bust, no blackjack).
export function dealerStep(round) {
  if (round.phase !== 'dealer') return false;
  round.holeHidden = false;
  const waiting = round.seats.some((seat) => seat.hands.some((hand) => !hand.result));
  if (waiting && total(round.dealer).value < DEALER_STANDS_ON) {
    round.dealer.push(round.shoe.pop());
    return true;
  }
  const dealerTotal = total(round.dealer).value;
  for (const seat of round.seats) {
    for (const hand of seat.hands) {
      if (hand.result) continue;
      const mine = total(hand.cards).value;
      hand.result = dealerTotal > 21 || mine > dealerTotal ? 'win' : mine < dealerTotal ? 'lose' : 'push';
    }
  }
  round.phase = 'over';
  return false;
}

// Once the round is over: what every stake pays back, [{ id, payout }]. A doubled hand pays on both stakes.
export function payouts(round) {
  const out = [];
  for (const seat of round.seats) {
    for (const hand of seat.hands) for (const s of hand.stakes) out.push({ id: s.id, payout: s.amount * PAYS[hand.result] });
    if (seat.insurance) out.push({ id: seat.insurance.id, payout: round.dealerBlackjack ? seat.insurance.amount * 3 : 0 });
  }
  return out;
}

// What everyone at the table may see: Trusty's hole card stays face down (null) until he turns it over.
export function view(round) {
  return {
    phase: round.phase,
    dealer: round.holeHidden ? [round.dealer[0], null] : round.dealer.slice(),
    dealerBlackjack: round.dealerBlackjack,
    turn: round.turn,
    active: round.active,
    seats: round.seats.map((seat) => ({
      id: seat.id,
      decided: seat.decided,
      insurance: seat.insurance ? seat.insurance.amount : 0,
      hands: seat.hands.map((hand) => ({
        cards: hand.cards.slice(), bet: handBet(hand), fromSplit: hand.fromSplit, done: hand.done, result: hand.result,
      })),
    })),
  };
}
