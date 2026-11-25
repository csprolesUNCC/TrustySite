// Events and boosts: for a few days, an admin can multiply some of the site's rewards ("Double TV clicks this
// weekend", a Thanksgiving event). Only one event at a time; it multiplies what's paid, never the daily caps, so
// a boosted day still takes the same playing time to reach them. Pure, shared by the banner every page shows
// (scripts/site.js), the admin panel, the API (utils/events.js, which every reward asks) and the pretend API.

// The rewards an event can boost, by key, with the name the banner and the admin panel use.
export const BOOSTS = {
  watch: 'Trusty TV and Radio',
  games: 'Flappy, Trustis and Snake',
  trustle: 'Trustle',
  dailyGames: 'Daily Games posts',
  daily: 'the daily bonus',
  quests: 'Daily Quests',
  golden: 'Golden Trusties',
};
export const BOOST_KEYS = Object.keys(BOOSTS);

// How much an event can multiply by, and the longest it can run (in days, from its first to its last).
export const TIMES = [2, 3];
export const MAX_DAYS = 14;
export const NAME_MAX = 60;
export const TEXT_MAX = 200;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A real day on the calendar, written as YYYY-MM-DD.
export function isDay(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

// How many days from `from` to `to`, counting both.
export const daysIn = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;

// An event from the API or an admin's form, checked: { name, text, boosts, times, from, to }, or null if any of it
// is wrong. `boosts` keeps the order of BOOST_KEYS and has each one once.
export function cleanEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { name, text = '', boosts, times, from, to } = raw;
  if (typeof name !== 'string' || typeof text !== 'string' || !Array.isArray(boosts)) return null;
  const n = name.trim().replace(/\s+/g, ' ');
  const t = text.trim();
  if (!n || n.length > NAME_MAX || t.length > TEXT_MAX) return null;
  if (!boosts.every((b) => typeof b === 'string' && Object.hasOwn(BOOSTS, b))) return null;
  const keys = BOOST_KEYS.filter((key) => boosts.includes(key));
  if (!keys.length || !TIMES.includes(times)) return null;
  if (!isDay(from) || !isDay(to) || to < from || daysIn(from, to) > MAX_DAYS) return null;
  return { name: n, text: t, boosts: keys, times, from, to };
}

// Whether `event` is on `today` (both 'YYYY-MM-DD', Eastern: events start and end at midnight Eastern).
export const isOn = (event, today) => Boolean(event && event.from <= today && today <= event.to);

// What a reward is multiplied by today: the event's `times` while it's on and boosts `key`, otherwise 1.
export function boostFor(event, key, today) {
  return isOn(event, today) && Array.isArray(event.boosts) && event.boosts.includes(key) ? event.times : 1;
}

const listFormat = typeof Intl.ListFormat === 'function' ? new Intl.ListFormat('en', { type: 'conjunction' }) : null;
const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
export const dayName = (day) => dateFormat.format(new Date(`${day}T12:00:00Z`));

// "2x clicks from Trusty TV and Radio and Trustle", for the banner and the admin panel.
export function boostLine(event) {
  const names = event.boosts.map((key) => BOOSTS[key]);
  return `${event.times}x clicks from ${listFormat ? listFormat.format(names) : names.join(', ')}`;
}

// When it ends (or starts), for the banner: "through Sun, Nov 30" or "from Fri, Nov 28 to Sun, Nov 30".
export function whenLine(event, today) {
  if (event.from > today) return `from ${dayName(event.from)} to ${dayName(event.to)}`;
  return event.to === today ? 'today only, until midnight Eastern' : `through ${dayName(event.to)}`;
}
