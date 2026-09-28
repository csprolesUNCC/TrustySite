// Trusty TV's "live" schedule. The lineup plays back to back, forever, reshuffled each time round, starting
// from a fixed moment, so the time alone says what's on and how far into it we are. Everyone does the same
// math and sees the same frame, with no server involved. Pure functions (no DOM), so they can be tested anywhere.

// When the channel went on air. Changing this or the lineup moves the whole schedule for everyone at once.
export const ON_AIR_SINCE = Date.UTC(2026, 0, 1);

// Takes a YouTube link (watch, youtu.be, shorts, embed or live) or a bare 11-character video id.
export function videoId(link) {
  const text = String(link || '').trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  const match = text.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return match ? match[1] : null;
}

// "10:35", "1:02:03" or a number of seconds.
export function toSeconds(length) {
  if (typeof length === 'number') return length;
  const parts = String(length || '').trim().split(':');
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

// `shuffle: false` keeps the lineup's own order every time round.
export function buildSchedule(lineup, { shuffle = true } = {}) {
  const shows = [];
  let total = 0;
  for (const entry of lineup) {
    const id = videoId(entry.link);
    const seconds = toSeconds(entry.length);
    if (!id || !(seconds > 0)) {
      console.warn('Trusty TV: skipping a show with a bad link or length', entry);
      continue;
    }
    shows.push({ id, title: entry.title || '', seconds });
    total += seconds;
  }
  return { shows, total, shuffle };
}

// A small seeded random generator (mulberry32), so every viewer gets the same "random" numbers.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(count, loop) {
  const order = Array.from({ length: count }, (_, i) => i);
  const random = seeded(Math.imul(loop, 0x9e3779b1) ^ 0x7e57);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// A video never comes back too soon when the lineup starts over: at least this many other shows air in between.
// It can be at most half the lineup (rounded down, not counting one show), so with 11 shows it tops out at 5.
export const MIN_GAP = 5;

// Each run through the lineup plays every show once, in its own shuffled order. The order comes from the run's
// number, so everyone gets the same one. A show that aired k from the end of the run before (0 for the last one)
// can't come back before position gap - k. Only the opening shows ever get swapped (with later ones, never the
// closing shows), so a run's closing shows are exactly its plain shuffle and the run before never has to be fixed
// up first. There's always a show that fits as long as the lineup has more than twice `gap` shows.
export function orderFor(schedule, loop) {
  const { shows } = schedule;
  const count = shows.length;
  if (schedule.shuffle === false) return Array.from({ length: count }, (_, i) => i);
  const order = shuffled(count, loop);
  const gap = Math.min(MIN_GAP, Math.floor((count - 1) / 2));
  if (!gap) return order;
  const before = shuffled(count, loop - 1);
  const fromEnd = new Map();
  for (let k = gap - 1; k >= 0; k--) fromEnd.set(shows[before[count - 1 - k]].id, k);
  const earliest = (i) => (fromEnd.has(shows[i].id) ? gap - fromEnd.get(shows[i].id) : 0);
  for (let p = 0; p < gap; p++) {
    if (earliest(order[p]) <= p) continue;
    for (let j = p + 1; j < count - gap; j++) {
      if (earliest(order[j]) <= p) {
        [order[p], order[j]] = [order[j], order[p]];
        break;
      }
    }
  }
  return order;
}

// What's on at `now` (ms): the show, how many seconds into it, and when it started and ends (ms).
// `index` is the show's place in the lineup; `slot` counts every airing ever, so it changes with each new show.
export function onAir(schedule, now, since = ON_AIR_SINCE) {
  const { shows, total } = schedule;
  if (!shows.length) return null;
  const elapsed = (now - since) / 1000;
  const loop = Math.floor(elapsed / total);
  const intoLoop = elapsed - loop * total;
  const loopStart = now - intoLoop * 1000;
  const order = orderFor(schedule, loop);
  let position = order.length - 1;
  let start = 0;
  for (let i = 0; i < order.length; i++) {
    if (intoLoop < start + shows[order[i]].seconds || i === order.length - 1) {
      position = i;
      break;
    }
    start += shows[order[i]].seconds;
  }
  const index = order[position];
  const show = shows[index];
  return {
    index,
    slot: loop * order.length + position,
    loop,
    position,
    show,
    offset: intoLoop - start,
    startsAt: loopStart + start * 1000,
    endsAt: loopStart + (start + show.seconds) * 1000,
  };
}

// The next `count` shows after `air` (what onAir returned), with the time each one starts (ms).
export function upNext(schedule, air, count) {
  const { shows } = schedule;
  const list = [];
  let { loop, position } = air;
  let order = orderFor(schedule, loop);
  let startsAt = air.endsAt;
  for (let k = 1; k <= count; k++) {
    if (++position >= order.length) {
      position = 0;
      order = orderFor(schedule, ++loop);
    }
    const show = shows[order[position]];
    list.push({ show, startsAt });
    startsAt += show.seconds * 1000;
  }
  return list;
}
