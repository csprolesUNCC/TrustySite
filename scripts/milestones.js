// What the header clicker's total adds up to, with no DOM: click ranks and the daily bonus. Used by the header
// (scripts/site.js), the clicks leaderboard (scripts/leaderboard.js), profiles and api/clicks.js.

/* ---------- Click ranks ---------- */

// A name for every milestone a player's clicks pass, lowest first. The header clicker's ring fills up toward
// the next one, and pages/leaderboard.html lists them all (tests/milestones.test.js checks that list matches).
export const RANKS = [
  { at: 100, name: 'Foal' },
  { at: 500, name: 'Pony' },
  { at: 1000, name: 'Trotter' },
  { at: 5000, name: 'Stallion' },
  { at: 10000, name: 'Racehorse' },
  { at: 25000, name: 'Derby Winner' },
  { at: 50000, name: 'Trusty’s Best Friend' },
  { at: 100000, name: 'Legend of the Notebook' },
  { at: 250000, name: 'Triple Crown' },
  { at: 500000, name: 'Pegasus' },
  { at: 1000000, name: 'Trusty Himself' },
];

const count = (clicks) => Math.max(0, Number(clicks) || 0);

// The highest rank `clicks` has reached, or null before the first one.
export function rankFor(clicks) {
  const n = count(clicks);
  let reached = null;
  for (const rank of RANKS) if (n >= rank.at) reached = rank;
  return reached;
}

// The next rank to reach, or null at the top.
export const nextRank = (clicks) => RANKS.find((rank) => count(clicks) < rank.at) || null;

// How far `clicks` has come from the last rank (or zero) toward the next one, from 0 to 1. 1 at the top.
export function rankProgress(clicks) {
  const n = count(clicks);
  const next = nextRank(n);
  if (!next) return 1;
  const from = rankFor(n)?.at ?? 0;
  return Math.min(1, (n - from) / (next.at - from));
}

// 1 for the first rank, 2 for the next and so on: badges are colored by it.
export const rankLevel = (rank) => RANKS.indexOf(rank) + 1;

/* ---------- The daily bonus ---------- */

// The first click of each day pays DAILY.base clicks, DAILY.step more for every day in a row before it, and
// never more than DAILY.max. A new day starts at midnight Eastern, the same moment as Trustle's new word, so
// it's the same day for everyone. pages/leaderboard.html says the same numbers (id="daily-rule").
export const DAILY = { base: 25, step: 10, max: 250 };

const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

// 'YYYY-MM-DD' on a clock in Eastern time.
export function dayOf(ms = Date.now()) {
  const p = {};
  for (const { type, value } of dayFormat.formatToParts(ms)) p[type] = value;
  return `${p.year}-${p.month}-${p.day}`;
}

// The day before a 'YYYY-MM-DD'.
export const dayBefore = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

// The bonus for the `streak`th day in a row.
export const dailyBonus = (streak) => Math.min(DAILY.max, DAILY.base + DAILY.step * (Math.max(1, Math.floor(streak) || 1) - 1));

// Claiming today's bonus, given the last one claimed (`{ day, streak }` as api/clicks.js keeps it on the
// account, or nothing): { streak, added }, or null if today's is already paid. The streak only carries on from
// yesterday; a missed day starts it over.
export function dailyClaim(last, today) {
  const day = last && typeof last.day === 'string' ? last.day : null;
  if (day && day >= today) return null;
  const streak = day === dayBefore(today) && Number.isSafeInteger(last.streak) && last.streak > 0 ? last.streak + 1 : 1;
  return { streak, added: dailyBonus(streak) };
}

// For the header clicker: whether today's bonus is still waiting (`ready`), the days in a row so far (0 once a
// day is missed) and the next bonus: today's while it's waiting, tomorrow's once it's paid.
export function dailyStatus(last, today) {
  const claim = dailyClaim(last, today);
  if (claim) return { ready: true, streak: claim.streak - 1, next: claim.added };
  const streak = Number.isSafeInteger(last.streak) && last.streak > 0 ? last.streak : 1;
  return { ready: false, streak, next: dailyBonus(streak + 1) };
}

/* ---------- Trusty gets tired ---------- */

// The header clicker pays a click for each of the day's first CLICKER.full presses, then one for every
// CLICKER.every presses after that, and nothing once it has paid CLICKER.max in the day (from midnight Eastern,
// like the daily bonus, which doesn't count towards it). Nobody clicking by hand notices; an autoclicker held at
// the 6-a-second limit all day would otherwise make half a million clicks. api/clicks.js counts the day's presses
// in the account's `clicker` ({ day, n }) and pays the same way (it builds its update from these numbers).
// pages/leaderboard.html says the same numbers (id="clicker-rule").
export const CLICKER = { full: 10000, every: 10, max: 15000 };

// The last press of a day that pays anything.
export const CLICKER_LAST = CLICKER.full + (CLICKER.max - CLICKER.full) * CLICKER.every;

// Whether the day's `n`th press (1 for the first) pays a click.
export const pressPays = (n) => Number.isSafeInteger(n) && n >= 1
  && (n <= CLICKER.full || (n <= CLICKER_LAST && (n - CLICKER.full) % CLICKER.every === 0));

// How many clicks the day's first `n` presses paid.
export function pressesPaid(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  return Math.min(CLICKER.max, Math.min(k, CLICKER.full) + Math.floor(Math.max(0, k - CLICKER.full) / CLICKER.every));
}

// Today's presses from an account's `clicker` ({ day, n }), 0 if they're from another day.
export const pressesToday = (clicker, today) => (clicker && clicker.day === today && Number.isSafeInteger(clicker.n) && clicker.n > 0 ? clicker.n : 0);

// How tired Trusty is after `n` presses today: 'fresh', 'tired' (one click in CLICKER.every) or 'done'.
export const tiredness = (n) => (n >= CLICKER_LAST ? 'done' : n >= CLICKER.full ? 'tired' : 'fresh');
