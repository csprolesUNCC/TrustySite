// Weekly leaderboards: the rules shared by the leaderboard page, the admin panel, the API (utils/weekly.js) and
// the pretend API. Pure functions, no DOM.
//
// Every game board (Flappy Trusty, Draw Trusty, Trustis, Trusty Snake) also has a board for this week: each
// player's best game since Monday 00:00 Eastern. It starts over at midnight Eastern between Sunday and Monday
// (the same clock as Trustle and the daily caps), and the top PLACES on each board are paid `prizes` clicks, as
// long as at least `minPlayers` people played it that week. Admins change the prizes in the admin panel's Weekly
// tab; DEFAULT_SETTINGS is what's paid until the first save. The clicks board has no weekly one: an autoclicker
// and casino wins would decide it.

import { dayOf } from './milestones.js';

export const WEEKLY_BOARDS = ['flappy', 'draw', 'trustis', 'snake'];
export const PLACES = 3;
// The most an admin can set one place to pay, so a typo can't hand out a fortune. Flappy's, Trustis's and
// Snake's scores come from the browser, so whatever 1st pays is what a cheater could collect every week.
export const MAX_PRIZE = 25000;
export const MAX_MIN_PLAYERS = 100;
export const DEFAULT_SETTINGS = Object.freeze({ on: true, prizes: Object.freeze([2500, 1500, 1000]), minPlayers: 5 });

const DAY_MS = 864e5;
const plusDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// The Monday ('YYYY-MM-DD', Eastern) that starts the week `ms` is in.
export function weekOf(ms = Date.now()) {
  const day = dayOf(ms);
  const sinceMonday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return plusDays(day, -sinceMonday);
}

export const weekBefore = (week) => plusDays(week, -7);
// The Sunday a week ends on (its last day; it starts over at the midnight after it).
export const weekEnds = (week) => plusDays(week, 6);

const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
export const dateLine = (day) => shortDate.format(new Date(`${day}T00:00:00Z`));
// "Nov 23 – Nov 29"
export const weekLine = (week) => `${dateLine(week)} – ${dateLine(weekEnds(week))}`;

// Settings as an admin sent them (or as saved), or null if anything's off.
export function cleanSettings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { on, prizes, minPlayers } = raw;
  if (typeof on !== 'boolean') return null;
  if (!Array.isArray(prizes) || prizes.length !== PLACES) return null;
  if (!prizes.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_PRIZE)) return null;
  if (!Number.isSafeInteger(minPlayers) || minPlayers < 1 || minPlayers > MAX_MIN_PLAYERS) return null;
  return { on, prizes: [...prizes], minPlayers };
}

// Who a finished week pays: the top of `top` (sorted best first, ties to whoever got there first), or nobody
// if prizes are off or too few played. Places that pay 0 are left out.
export function winnersOf(top, players, settings) {
  if (!settings.on || players < settings.minPlayers) return [];
  return top.slice(0, PLACES)
    .map((entry, i) => ({ ...entry, place: i + 1, prize: settings.prizes[i] }))
    .filter((w) => w.prize > 0);
}

// "2,500 / 1,500 / 1,000 clicks"
export function prizeLine(settings) {
  return `${settings.prizes.map((n) => n.toLocaleString('en-US')).join(' / ')} clicks`;
}
