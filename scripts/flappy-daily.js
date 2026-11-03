// Daily Flappy: one pencil course a day, the same for everyone, with DAILY_TRIES tries to set your best.
// A new course starts at midnight Eastern (the same moment as Trustle's word and the joke of the day).
// Pure functions (no DOM), shared by pages/games/flappy.html and the daily board in utils/flappy-daily.js.

const ZONE = 'America/New_York';
const FIRST_DAY = '2026-11-03'; // Daily course #1
const DAY = 24 * 60 * 60 * 1000;

export const DAILY_TRIES = 3;

// The date on a clock in ZONE ('YYYY-MM-DD', which en-CA writes dates as), read back as a UTC midnight.
const zoneDate = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Which daily course is on at `ms`: 1 on FIRST_DAY, 2 the day after, and so on (0 or less before it). */
export function courseNumber(ms = Date.now()) {
  return Math.round((Date.parse(zoneDate.format(ms)) - Date.parse(FIRST_DAY)) / DAY) + 1;
}

/**
 * The random numbers for course `n`: a function that returns the same sequence (0 to 1) on every device,
 * used in place of Math.random for the pencil gaps. mulberry32, seeded from the course number.
 */
export function courseRandom(n) {
  let a = (Math.imul(n, 0x9e3779b1) ^ 0x5eed7) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
