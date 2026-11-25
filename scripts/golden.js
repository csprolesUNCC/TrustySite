// Golden Trusties: a few times a day a small gold Trusty pops up somewhere on the page for GOLDEN.show seconds,
// and catching him (clicking) pays a bonus. The server decides when one is due and hands the page a one-time
// token, so a script can't make one appear; at most GOLDEN.perDay are caught a day (from midnight Eastern), so
// one that catches every one still only gets a few hundred clicks. Missed ones don't count towards that.
// Pure, shared by the API (utils/golden.js), the page's side (scripts/golden-trusty.js) and the pretend API.

export const GOLDEN = {
  perDay: 5, // the most caught in a day
  min: 100, // what one pays, in steps of `step` (before any event's boost, scripts/events.js)
  max: 300,
  step: 25,
  show: 15, // seconds he stays on the page
  firstWait: [3, 10], // minutes from the day's first look until the first one
  gap: [25, 60], // minutes from one to the next
};

// A catch still counts this long after he's gone from the page, for a slow connection.
export const SLACK_MS = 3000;
export const TOKEN = /^[0-9a-f]{32}$/;

const minutes = ([lo, hi], random) => Math.round((lo + random() * (hi - lo)) * 60000);

// What catching one pays, from a random number in [0, 1).
export const prize = (random) => GOLDEN.min + Math.floor(random() * ((GOLDEN.max - GOLDEN.min) / GOLDEN.step + 1)) * GOLDEN.step;

// The day's Golden Trusties for an account, `golden` on its `click_game` document: { day, n (caught today), next
// (when the next one is due, ms) } plus { token, until (ms) } while one is out.
// Given what's saved, what the page should do now: { state, show, wait, left }. `state` is what to save, or null
// to leave it; `show` is { token, ms } when one is out (ms: how long it stays); `wait` is how long until the next
// one is due (null when the day's are used up); `left` how many can still be caught today. `token()` makes a new
// token (crypto on the server).
export function decide(saved, today, now, random, token) {
  const fresh = !(saved && saved.day === today && Number.isSafeInteger(saved.n) && Number.isFinite(saved.next));
  const g = fresh ? { day: today, n: 0, next: now + minutes(GOLDEN.firstWait, random) } : saved;
  const left = Math.max(0, GOLDEN.perDay - g.n);
  const keep = fresh ? g : null;
  if (!left) return { state: keep, show: null, wait: null, left };
  if (typeof g.token === 'string' && Number(g.until) - SLACK_MS > now) {
    return { state: keep, show: { token: g.token, ms: Number(g.until) - SLACK_MS - now }, wait: null, left };
  }
  if (now >= g.next) {
    const ms = GOLDEN.show * 1000;
    const state = { day: today, n: g.n, next: now + ms + minutes(GOLDEN.gap, random), token: token(), until: now + ms + SLACK_MS };
    return { state, show: { token: state.token, ms }, wait: null, left };
  }
  return { state: keep, show: null, wait: g.next - now, left };
}
