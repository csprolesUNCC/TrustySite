// Trusty TV's "live" schedule. The lineup plays back to back, forever, starting from a fixed moment, so the
// time alone says what's on and how far into it we are. Everyone does the same math and sees the same
// frame, with no server involved. Pure functions (no DOM), so they can be tested anywhere.

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

export function buildSchedule(lineup) {
  const shows = [];
  let start = 0;
  for (const entry of lineup) {
    const id = videoId(entry.link);
    const seconds = toSeconds(entry.length);
    if (!id || !(seconds > 0)) {
      console.warn('Trusty TV: skipping a show with a bad link or length', entry);
      continue;
    }
    shows.push({ id, title: entry.title || '', start, seconds });
    start += seconds;
  }
  return { shows, total: start };
}

// What's on at `now` (ms): the show, how many seconds into it, and when it started and ends (ms).
export function onAir(schedule, now, since = ON_AIR_SINCE) {
  const { shows, total } = schedule;
  if (!shows.length) return null;
  const intoLoop = ((((now - since) / 1000) % total) + total) % total;
  const loopStart = now - intoLoop * 1000;
  let index = shows.length - 1;
  for (let i = 0; i < shows.length; i++) {
    if (intoLoop < shows[i].start + shows[i].seconds) {
      index = i;
      break;
    }
  }
  const show = shows[index];
  return {
    index,
    show,
    offset: intoLoop - show.start,
    startsAt: loopStart + show.start * 1000,
    endsAt: loopStart + (show.start + show.seconds) * 1000,
  };
}

// The next `count` shows after `air` (what onAir returned), with the time each one starts (ms).
export function upNext(schedule, air, count) {
  const { shows } = schedule;
  const list = [];
  let startsAt = air.endsAt;
  for (let k = 1; k <= count; k++) {
    const show = shows[(air.index + k) % shows.length];
    list.push({ show, startsAt });
    startsAt += show.seconds * 1000;
  }
  return list;
}
