// Trusty Slots rules: pure functions, no DOM, shared by the page (pages/games/slots.html, to draw the reels and
// the paytable), the game (utils/solo-slots-game.js, which spins) and the tests. All plain data, so the tests can
// pick where the reels stop.
//
// One machine, Trusty's Hay Day (MACHINE), with a bonus game inside it, the Golden Horse (BONUS). Each has three
// reels that all carry the same strip of symbols, and one payline across the middle. A spin is three stops, one
// per reel (an index into the strip); the payline shows strip[stop] on each reel, with the symbols either side of
// it on the strip above and below. Three of a kind pays `three[symbol]` times the bet; failing that, exactly two
// of a symbol in `two` (anywhere on the line) pays `two[symbol]` times. What a spin pays is the whole amount that
// comes back, so 2 times a bet is the bet and as much again.
//
// The bonus: the Hay Day's strip has a few Golden Horse tiles (MACHINE.scatter). When one is showing on every
// reel, anywhere in the window (above, on or below the line), the spin also wins BONUS.spins free spins on the
// Golden Horse's reels, each paying its own paytable times the bet that triggered them.
//
// The Grand Jackpot (JACKPOT): a pot every player's spins build up together. A share of every bet goes into it,
// and any spin can win the whole of it at once, whatever the reels show; the bigger the bet, the better the chance
// (jackpotChance). After a win it starts again from JACKPOT.seed. It stops growing at JACKPOT.max, which is what
// keeps the machine a loser for its players however long the pot goes unwon.
//
// The house always wins: with the bonus and the jackpot counted in, the machine pays back less than is bet in the
// long run, and less than is bet even on a spin at a full pot (rtp() adds it up exactly, and tests/slots.test.js
// keeps it between RTP.min and RTP.max). Change a strip, a paytable or the jackpot's numbers and run the tests.

// Bets in tens, like the tables', but smaller: one spin can pay up to MAX_RETURN times its bet.
export const BETS = { min: 10, max: 100, step: 10 };
export const CHIPS = [10, 20, 50, 100];
export const isBet = (n) => Number.isSafeInteger(n) && n >= BETS.min && n <= BETS.max && n % BETS.step === 0;
// What the machine has to pay back in the long run, as a share of what's bet.
export const RTP = { min: 0.9, max: 0.955 };
export const REELS = 3;

// The Grand Jackpot. rate: the share of every bet that goes into the pot. seed: what it starts from after a win
// (the house puts that in). max: where it stops growing. odds: a spin at the biggest bet wins it 1 time in this
// many; a smaller bet has that much less of a chance (a 10-click spin, a tenth of a 100-click one), so a click
// bet is worth the same shot at the pot whatever the bet.
export const JACKPOT = { rate: 0.02, seed: 1000, max: 25000, odds: 5000 };
export const jackpotChance = (amount) => (isBet(amount) ? amount / BETS.max / JACKPOT.odds : 0);
const WINDOW = [-1, 0, 1]; // the symbols a stopped reel shows: above the line, on it, below it

// Trusty's Hay Day.
export const MACHINE = {
  key: 'hay',
  name: 'Trusty’s Hay Day',
  symbols: {
    trusty: 'Trusty', seven: 'Seven', shoe: 'Horseshoe', pencil: 'Pencil', apple: 'Apple', carrot: 'Carrot', hay: 'Hay',
    bonus: 'Golden Horse',
  },
  // The Golden Horse tiles are far enough apart that a reel never shows two at once.
  strip: [
    'hay', 'carrot', 'apple', 'pencil', 'shoe', 'hay', 'bonus', 'carrot', 'seven', 'apple', 'pencil', 'hay', 'carrot',
    'shoe', 'apple', 'hay', 'pencil', 'carrot', 'trusty', 'hay', 'bonus', 'apple', 'shoe', 'carrot', 'pencil', 'seven',
  ],
  three: { trusty: 50, seven: 40, shoe: 25, pencil: 12, apple: 12, carrot: 7, hay: 5 },
  two: { trusty: 10, seven: 5, apple: 2, carrot: 2, hay: 2 },
  jackpot: 'trusty',
  scatter: 'bonus',
};

// The Golden Horse: the free spins. Wins less often than the Hay Day, pays big (88 is the lucky number, and there
// are 8 spins for the same reason).
export const BONUS = {
  key: 'golden',
  name: 'Golden Horse',
  spins: 8,
  // The symbols are Chinese characters on tiles; `chars` is what's drawn, `symbols` what a screen reader says.
  symbols: { ma: 'Horse', long: 'Dragon', fa: 'Prosperity', fu: 'Fortune', xi: 'Double Happiness', jin: 'Gold' },
  chars: { ma: '馬', long: '龍', fa: '發', fu: '福', xi: '囍', jin: '金' },
  strip: [
    'jin', 'xi', 'fu', 'jin', 'fa', 'xi', 'long', 'jin', 'xi', 'fu', 'ma', 'jin', 'xi', 'fa', 'fu', 'jin',
    'xi', 'long', 'jin', 'fu', 'xi', 'fa', 'jin', 'xi', 'fu', 'ma', 'jin', 'xi', 'long', 'fu', 'jin', 'fa',
  ],
  three: { ma: 88, long: 38, fa: 28, fu: 12, xi: 8, jin: 5 },
  two: { ma: 8, long: 3, jin: 2 },
  jackpot: 'ma',
};

// The most one spin can pay back, as a multiple of what was bet: the Hay Day's top prize with the bonus on the
// same spin, the Golden Horse's top prize on every free spin, and a full Grand Jackpot won on the smallest bet.
// utils/bank-rules.js caps payouts at it.
const top = (machine) => Math.max(...Object.values(machine.three));
export const MAX_RETURN = top(MACHINE) + BONUS.spins * top(BONUS) + JACKPOT.max / BETS.min;

// Where the reels stop: one index into the strip per reel. random() is 0 <= n < 1.
export function spin(machine, random) {
  return Array.from({ length: REELS }, () => Math.floor(random() * machine.strip.length));
}

export function isStops(machine, stops) {
  return Array.isArray(stops) && stops.length === REELS
    && stops.every((s) => Number.isSafeInteger(s) && s >= 0 && s < machine.strip.length);
}

// The symbol `offset` places below a reel's stop (negative: above), around the strip.
export function symbolAt(machine, stop, offset = 0) {
  const n = machine.strip.length;
  return machine.strip[(((stop + offset) % n) + n) % n];
}

// The payline: the symbol each reel stopped on.
export const lineOf = (machine, stops) => stops.map((stop) => symbolAt(machine, stop));

// What a payline pays: { times (0 for nothing), kind: 'three' | 'two' | null, symbol }.
export function payFor(machine, line) {
  if (line.every((s) => s === line[0])) {
    const times = machine.three[line[0]] || 0;
    return times ? { times, kind: 'three', symbol: line[0] } : { times: 0, kind: null, symbol: null };
  }
  let best = { times: 0, kind: null, symbol: null };
  for (const [symbol, times] of Object.entries(machine.two)) {
    if (line.filter((s) => s === symbol).length === 2 && times > best.times) best = { times, kind: 'two', symbol };
  }
  return best;
}

// Where the Golden Horse tile is showing on each reel: -1 (above the line), 0, 1, or null when it isn't.
export function scattersAt(stops) {
  return stops.map((stop) => {
    const at = WINDOW.find((offset) => symbolAt(MACHINE, stop, offset) === MACHINE.scatter);
    return at === undefined ? null : at;
  });
}
// Whether these stops win the bonus: a Golden Horse tile showing on every reel.
export const triggers = (stops) => scattersAt(stops).every((at) => at !== null);

// One whole spin of the machine: the Hay Day's reels and, if they win the bonus, every free spin with them.
// { stops, line, times, kind, symbol, bonus: null | { spins: [{ stops, line, times, kind, symbol }], times },
// total }: `times` is what the Hay Day's line pays, `bonus.times` what the free spins add up to, `total` both,
// all as multiples of the bet.
export function play(random) {
  const stops = spin(MACHINE, random);
  const line = lineOf(MACHINE, stops);
  const pay = payFor(MACHINE, line);
  let bonus = null;
  if (triggers(stops)) {
    const spins = Array.from({ length: BONUS.spins }, () => {
      const free = spin(BONUS, random);
      const freeLine = lineOf(BONUS, free);
      return { stops: free, line: freeLine, ...payFor(BONUS, freeLine) };
    });
    bonus = { spins, times: spins.reduce((sum, s) => sum + s.times, 0) };
  }
  return { stops, line, ...pay, bonus, total: pay.times + (bonus ? bonus.times : 0) };
}

// How big a win is, for the show: 'jackpot' (three of the machine's top symbol), 'big' (20 times or more), 'win',
// or null.
export function tierOf(machine, pay) {
  if (!pay.times) return null;
  if (pay.kind === 'three' && pay.symbol === machine.jackpot) return 'jackpot';
  return pay.times >= 20 ? 'big' : 'win';
}

// Every way one machine's reels can stop, added up: { back (what its paytable pays per click bet), hit (how often
// a spin pays) }.
function lineOdds(machine) {
  const n = machine.strip.length;
  let paid = 0;
  let hits = 0;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      for (let c = 0; c < n; c++) {
        const { times } = payFor(machine, lineOf(machine, [a, b, c]));
        paid += times;
        if (times) hits += 1;
      }
    }
  }
  return { back: paid / n ** 3, hit: hits / n ** 3 };
}

// The whole machine, bonus and jackpot included: { rtp (what comes back per click bet in the long run), hit (how
// often a spin's line pays), line (the share that comes from the Hay Day's own paytable), bonusEvery (spins per
// bonus, on average), bonusPays (what a bonus pays on average, in bets), jackpot (the share that comes back
// through the Grand Jackpot: what goes in, plus the house's seed), worst (what a spin pays back on average while
// the pot is full, the most the machine ever pays) }.
export function rtp() {
  const base = lineOdds(MACHINE);
  const n = MACHINE.strip.length;
  let wins = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) if (triggers([a, b, c])) wins += 1;
  const chance = wins / n ** 3;
  const bonusPays = BONUS.spins * lineOdds(BONUS).back;
  const reels = base.back + chance * bonusPays;
  const perClick = 1 / (JACKPOT.odds * BETS.max); // the chance of the pot that each click bet buys
  const jackpot = JACKPOT.rate + JACKPOT.seed * perClick;
  return {
    rtp: reels + jackpot, hit: base.hit, line: base.back, bonusEvery: 1 / chance, bonusPays, jackpot,
    worst: reels + JACKPOT.max * perClick,
  };
}
