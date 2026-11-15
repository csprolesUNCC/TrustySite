// Trusty Slots rules: pure functions, no DOM, shared by the page (pages/games/slots.html, to draw the reels and
// the paytable), the game (utils/solo-slots-game.js, which spins) and the tests. All plain data, so the tests can
// pick where the reels stop.
//
// A machine has three reels that all carry the same strip of symbols, and one payline across the middle. A spin
// is three stops, one per reel (an index into the strip); the payline shows strip[stop] on each reel, with the
// symbols either side of it on the strip above and below. Three of a kind pays `three[symbol]` times the bet;
// failing that, exactly two of a symbol in `two` (anywhere on the line) pays `two[symbol]` times. What a spin
// pays is the whole amount that comes back, so 2 times a bet is the bet and as much again.
//
// The house always wins: every strip and paytable here pays back less than is bet in the long run (rtp() adds it
// up exactly, and tests/slots.test.js keeps every machine between RTP.min and RTP.max). Change a strip or a
// paytable and run the tests.

// Bets in tens, like the tables', but smaller: one spin can pay up to MAX_RETURN times its bet.
export const BETS = { min: 10, max: 100, step: 10 };
export const CHIPS = [10, 20, 50, 100];
export const isBet = (n) => Number.isSafeInteger(n) && n >= BETS.min && n <= BETS.max && n % BETS.step === 0;
// What every machine has to pay back in the long run, as a share of what's bet.
export const RTP = { min: 0.9, max: 0.955 };
export const REELS = 3;

export const MACHINES = {
  // Trusty's Hay Day: the friendly one. Wins often, pays small.
  hay: {
    key: 'hay',
    name: 'Trusty’s Hay Day',
    symbols: {
      trusty: 'Trusty', seven: 'Seven', shoe: 'Horseshoe', pencil: 'Pencil', apple: 'Apple', carrot: 'Carrot', hay: 'Hay',
    },
    strip: [
      'hay', 'carrot', 'apple', 'pencil', 'shoe', 'hay', 'carrot', 'seven', 'apple', 'pencil', 'hay', 'carrot',
      'shoe', 'apple', 'hay', 'pencil', 'carrot', 'trusty', 'hay', 'apple', 'shoe', 'carrot', 'pencil', 'seven',
    ],
    three: { trusty: 50, seven: 30, shoe: 20, pencil: 10, apple: 10, carrot: 5, hay: 5 },
    two: { trusty: 10, seven: 5, apple: 2, carrot: 2, hay: 2 },
    jackpot: 'trusty',
  },
  // Golden Horse: the Year of the Horse machine. Wins less often, pays big (88 is the lucky number).
  golden: {
    key: 'golden',
    name: 'Golden Horse',
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
  },
};
export const MACHINE_KEYS = Object.keys(MACHINES);
export const isMachine = (key) => typeof key === 'string' && Object.hasOwn(MACHINES, key);

// The most any spin pays back, as a multiple of what was bet. utils/bank-rules.js caps payouts at it.
export const MAX_RETURN = Math.max(...Object.values(MACHINES).map((m) => Math.max(...Object.values(m.three))));

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
  if (line.every((s) => s === line[0])) return { times: machine.three[line[0]] || 0, kind: 'three', symbol: line[0] };
  let best = { times: 0, kind: null, symbol: null };
  for (const [symbol, times] of Object.entries(machine.two)) {
    if (line.filter((s) => s === symbol).length === 2 && times > best.times) best = { times, kind: 'two', symbol };
  }
  return best;
}

// How big a win is, for the lights and the noise: 'jackpot' (three of the top symbol), 'big' (20 times or more),
// 'win', or null.
export function tierOf(machine, pay) {
  if (!pay.times) return null;
  if (pay.kind === 'three' && pay.symbol === machine.jackpot) return 'jackpot';
  return pay.times >= 20 ? 'big' : 'win';
}

// Every way the reels can stop, added up: { rtp (what comes back per click bet), hit (how often a spin pays) }.
export function rtp(machine) {
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
  return { rtp: paid / n ** 3, hit: hits / n ** 3 };
}
