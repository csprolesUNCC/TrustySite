// The rules for the site's hand-written lists (fun facts, TV and radio lineups), from CLAUDE.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, MAX_LENGTH, factOfTheDay } from '../scripts/facts.js';
import { CHANNELS } from '../scripts/tv-lineup.js';
import { STATIONS, BAND } from '../scripts/radio-lineup.js';
import { videoId, toSeconds } from '../scripts/tv-schedule.js';

test('every fun fact is filled in, told once and at most MAX_LENGTH characters', () => {
  assert.equal(MAX_LENGTH, 360);
  const seen = new Set();
  for (const fact of FACTS) {
    assert.equal(typeof fact, 'string');
    assert.ok(fact.trim(), 'empty fact');
    assert.ok(fact.length <= MAX_LENGTH, `too long (${fact.length}): "${fact.slice(0, 60)}..."`);
    assert.ok(!seen.has(fact), `told twice: "${fact.slice(0, 60)}..."`);
    seen.add(fact);
  }
});

test('the fun fact of the day changes at midnight Eastern and is the same all day', () => {
  // 2026-11-03 is Eastern Standard Time (UTC-5): midnight is 05:00 UTC.
  const before = factOfTheDay(Date.parse('2026-11-03T04:59:59Z'));
  const after = factOfTheDay(Date.parse('2026-11-03T05:00:00Z'));
  const evening = factOfTheDay(Date.parse('2026-11-04T04:00:00Z'));
  assert.notEqual(before, after);
  assert.equal(after, evening);
  assert.ok(FACTS.includes(after));
});

const lineups = [
  ...CHANNELS.map((c) => [`TV ${c.key}`, c.lineup]),
  ...STATIONS.map((s) => [`radio ${s.key}`, s.lineup]),
];

for (const [name, lineup] of lineups) {
  test(`${name}: every show has a YouTube link and a length, and none is listed twice`, () => {
    const ids = new Set();
    for (const entry of lineup) {
      const id = videoId(entry.link);
      assert.ok(id, `bad link: ${entry.link}`);
      assert.ok(toSeconds(entry.length) > 0, `bad length for ${entry.title}: ${entry.length}`);
      assert.match(String(entry.length), /^\d+(:\d{2}){0,2}$/, `${entry.title}: length should look like 3:46 or 1:02:03`);
      assert.ok(!ids.has(id), `listed twice: ${entry.title} (${id})`);
      ids.add(id);
    }
  });
}

test('channel and station keys are unique and stations sit on the dial', () => {
  const keys = (list) => list.map((x) => x.key);
  assert.equal(new Set(keys(CHANNELS)).size, CHANNELS.length);
  assert.equal(new Set(keys(STATIONS)).size, STATIONS.length);
  for (const s of STATIONS) assert.ok(s.frequency >= BAND.low && s.frequency <= BAND.high, `${s.name} at ${s.frequency}`);
});
