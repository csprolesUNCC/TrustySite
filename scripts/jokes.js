// Trusty's joke of the day, for the speech bubble on the home page. A new joke starts every day at midnight
// Eastern time (the same moment as Trustle's new word), so everybody gets the same one. The list plays in
// order from FIRST_DAY, then starts over.
//
// Add new jokes at the end: putting one earlier changes the joke for every day after it, today's included.

const ZONE = 'America/New_York';
const FIRST_DAY = '2026-10-22';
const DAY = 24 * 60 * 60 * 1000;

// { setup, punchline } — punchline is '' for a one-liner. Keep setup + punchline to 90 characters or the
// bubble spills onto his back on small phones.
export const JOKES = [
  { setup: 'Why did my henchman bring a ladder to the evil lair meeting?', punchline: 'He heard the bar was high.' },
];

// The date on a clock in ZONE ('YYYY-MM-DD', which en-CA writes dates as), read back as a UTC midnight.
const zoneDate = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export function jokeOfTheDay(ms = Date.now()) {
  const day = Math.round((Date.parse(zoneDate.format(ms)) - Date.parse(FIRST_DAY)) / DAY);
  return JOKES[((day % JOKES.length) + JOKES.length) % JOKES.length];
}
