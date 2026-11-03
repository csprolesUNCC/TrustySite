import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoId, toSeconds, buildSchedule, orderFor, onAir, upNext, MIN_GAP, ON_AIR_SINCE } from '../scripts/tv-schedule.js';

test('videoId() reads every kind of YouTube link', () => {
  const id = 'RVlvK8WCnJs';
  for (const link of [id, `https://youtu.be/${id}?si=x`, `https://www.youtube.com/watch?v=${id}&t=3`, `https://www.youtube.com/embed/${id}`,
    `https://youtube.com/shorts/${id}`, `https://www.youtube.com/live/${id}`]) assert.equal(videoId(link), id, link);
  assert.equal(videoId('https://example.com/'), null);
});

test('toSeconds() reads m:ss and h:mm:ss', () => {
  assert.equal(toSeconds('3:46'), 226);
  assert.equal(toSeconds('1:02:03'), 3723);
  assert.equal(toSeconds(90), 90);
  assert.ok(Number.isNaN(toSeconds('soon')));
});

// A made-up lineup: 12 shows of different lengths.
const lineup = Array.from({ length: 12 }, (_, i) => ({ title: `Show ${i}`, link: `https://youtu.be/${String(i).padStart(11, 'x')}`, length: `${2 + i}:${String((i * 7) % 60).padStart(2, '0')}` }));
const schedule = buildSchedule(lineup);

test('every run plays each show once', () => {
  for (let loop = 0; loop < 50; loop++) {
    assert.deepEqual([...orderFor(schedule, loop)].sort((a, b) => a - b), schedule.shows.map((_, i) => i), `run ${loop}`);
  }
});

test(`a show never comes back within ${MIN_GAP} other shows when a run starts over`, () => {
  const aired = [];
  for (let loop = 0; loop < 200; loop++) aired.push(...orderFor(schedule, loop));
  for (let i = 0; i < aired.length; i++) {
    for (let k = 1; k <= MIN_GAP && i + k < aired.length; k++) assert.notEqual(aired[i], aired[i + k], `slot ${i} and ${i + k}`);
  }
});

test('onAir() and upNext() agree: each show starts the moment the last one ends', () => {
  let now = ON_AIR_SINCE + 123456789;
  let air = onAir(schedule, now);
  for (let step = 0; step < 100; step++) {
    assert.ok(air.offset >= 0 && air.offset < air.show.seconds, 'offset inside the show');
    assert.equal(air.startsAt + air.offset * 1000, now);
    const [next] = upNext(schedule, air, 1);
    now = air.endsAt;
    air = onAir(schedule, now);
    assert.equal(air.show, next.show, `step ${step}`);
    assert.equal(air.startsAt, next.startsAt);
  }
});

test('everyone sees the same thing at the same moment', () => {
  const now = Date.parse('2026-11-03T20:15:00Z');
  assert.deepEqual(onAir(buildSchedule(lineup), now), onAir(schedule, now));
});
