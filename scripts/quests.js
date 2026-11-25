// Daily Quests: every day at midnight Eastern, everyone gets the same three small jobs, picked from QUESTS by the
// date. Each one done pays QUEST_REWARD clicks and doing all three pays ALL_BONUS more (an event can multiply both,
// scripts/events.js). Every quest is checked by the server from what it already keeps on the account's
// `click_game` document (the clicker's presses, Trusty TV and Radio's `mediaDaily`, the games' `gameDaily`,
// Trustle's `trustleRewards`) and the Daily Games board, never from anything the page says.
// Pure, shared by the quests panel (scripts/quests-panel.js), the API (utils/quests.js) and the pretend API.
import { WATCH_REWARD } from './tv-schedule.js';
import { GAME_REWARDS } from './game-rewards.js';
import { pressesToday } from './milestones.js';

export const QUEST_REWARD = 150;
export const ALL_BONUS = 300;
export const PER_DAY = 3;

// `kind` says what's counted (factsOf), `at` how much of it. No two of a day's quests have the same kind.
export const QUESTS = [
  { id: 'click-250', kind: 'clicker', at: 250, text: 'Click Trusty 250 times', href: null },
  { id: 'click-500', kind: 'clicker', at: 500, text: 'Click Trusty 500 times', href: null },
  { id: 'click-1000', kind: 'clicker', at: 1000, text: 'Click Trusty 1,000 times', href: null },
  { id: 'watch-3', kind: 'watch', at: 180, text: 'Watch Trusty TV or listen to Trusty Radio for 3 minutes', href: '/pages/tv.html' },
  { id: 'watch-5', kind: 'watch', at: 300, text: 'Watch Trusty TV or listen to Trusty Radio for 5 minutes', href: '/pages/tv.html' },
  { id: 'watch-10', kind: 'watch', at: 600, text: 'Watch Trusty TV or listen to Trusty Radio for 10 minutes', href: '/pages/radio.html' },
  { id: 'flappy-10', kind: 'flappy', at: 10, text: 'Score 10 points in Flappy Trusty', href: '/pages/games/flappy.html' },
  { id: 'flappy-25', kind: 'flappy', at: 25, text: 'Score 25 points in Flappy Trusty', href: '/pages/games/flappy.html' },
  { id: 'flappy-50', kind: 'flappy', at: 50, text: 'Score 50 points in Flappy Trusty', href: '/pages/games/flappy.html' },
  { id: 'trustis-10k', kind: 'trustis', at: 10000, text: 'Score 10,000 points in Trustis', href: '/pages/games/trustis.html' },
  { id: 'trustis-30k', kind: 'trustis', at: 30000, text: 'Score 30,000 points in Trustis', href: '/pages/games/trustis.html' },
  { id: 'snake-10', kind: 'snake', at: 10, text: 'Eat 10 snacks in Trusty Snake', href: '/pages/games/snake.html' },
  { id: 'snake-25', kind: 'snake', at: 25, text: 'Eat 25 snacks in Trusty Snake', href: '/pages/games/snake.html' },
  { id: 'trustle', kind: 'trustle', at: 1, text: 'Finish today’s Trustle', href: '/pages/games/trustle.html' },
  { id: 'daily-1', kind: 'dailyGames', at: 1, text: 'Post a result on Daily Games', href: '/pages/daily.html' },
  { id: 'daily-2', kind: 'dailyGames', at: 2, text: 'Post 2 results on Daily Games', href: '/pages/daily.html' },
];

const byId = new Map(QUESTS.map((q) => [q.id, q]));
export const questById = (id) => (typeof id === 'string' && byId.get(id)) || null;

// How a quest's count is shown: minutes for watching, a number for the rest.
export function amountText(quest, n) {
  const count = Math.max(0, Math.min(quest.at, Math.floor(n) || 0));
  if (quest.kind === 'watch') return `${Math.floor(count / 60)} of ${quest.at / 60} min`;
  return `${count.toLocaleString('en-US')} of ${quest.at.toLocaleString('en-US')}`;
}

// A small random-number maker seeded by the day, so everyone gets the same quests.
function seeded(day) {
  let h = 2166136261;
  for (const ch of String(day)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The day's quests ('YYYY-MM-DD', Eastern), PER_DAY of them with different kinds.
export function questsFor(day) {
  const random = seeded(day);
  const order = QUESTS.map((q) => [random(), q]).sort((a, b) => a[0] - b[0]).map(([, q]) => q);
  const picked = [];
  for (const quest of order) {
    if (picked.length >= PER_DAY) break;
    if (!picked.some((q) => q.kind === quest.kind)) picked.push(quest);
  }
  return picked;
}

const whole = (n) => (Number.isSafeInteger(n) && n > 0 ? n : 0);

// What the account has done today, by kind, from its `click_game` document. `trustle` is whether today's puzzle
// has been paid (trustleRewards has it), `posts` how many Daily Games results it posted today: the API looks
// those up.
export function factsOf(doc, today, { trustle = false, posts = 0 } = {}) {
  const d = doc || {};
  const media = d.mediaDaily && d.mediaDaily.day === today ? whole(d.mediaDaily.clicks) : 0;
  const played = (game) => {
    const counted = d.gameDaily && d.gameDaily[game];
    const clicks = counted && counted.day === today ? whole(counted.clicks) : 0;
    const rule = GAME_REWARDS[game];
    return Math.floor(clicks / rule.clicks) * rule.per;
  };
  return {
    clicker: pressesToday(d.clicker, today),
    watch: Math.floor(media / WATCH_REWARD.clicks) * WATCH_REWARD.every,
    flappy: played('flappy'),
    trustis: played('trustis'),
    snake: played('snake'),
    trustle: trustle ? 1 : 0,
    dailyGames: whole(posts),
  };
}

// The quests paid so far today from the account's `quests` ({ day, done: [ids], bonus }).
export function paidToday(saved, today) {
  if (!saved || saved.day !== today || !Array.isArray(saved.done)) return { done: [], bonus: false };
  return { done: saved.done.filter((id) => typeof id === 'string'), bonus: saved.bonus === true };
}

// Today's quests with how far along each one is: [{ ...quest, count, complete, paid }].
export function questStatus(today, facts, paid) {
  return questsFor(today).map((quest) => {
    const count = Math.min(quest.at, whole(facts && facts[quest.kind]));
    return { ...quest, count, complete: count >= quest.at, paid: paid.done.includes(quest.id) };
  });
}

// What a claim pays now (before any event's boost): the quests done but not paid yet and, once all of them are,
// the bonus. { ids, bonus, added }.
export function toClaim(status, paid) {
  const ids = status.filter((q) => q.complete && !q.paid).map((q) => q.id);
  const bonus = !paid.bonus && status.every((q) => q.complete);
  return { ids, bonus, added: ids.length * QUEST_REWARD + (bonus ? ALL_BONUS : 0) };
}
