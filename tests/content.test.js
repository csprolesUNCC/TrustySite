// The rules for the site's hand-written lists (jokes, TV and radio lineups), from CLAUDE.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOKES, jokeOfTheDay } from '../scripts/jokes.js';
import { CHANNELS } from '../scripts/tv-lineup.js';
import { STATIONS, BAND } from '../scripts/radio-lineup.js';
import { videoId, toSeconds } from '../scripts/tv-schedule.js';

test('every joke has a setup and punchline, 90 characters at most together', () => {
  const setups = new Set();
  for (const { setup, punchline } of JOKES) {
    assert.equal(typeof setup, 'string');
    assert.equal(typeof punchline, 'string');
    assert.ok(setup, 'a joke needs a setup (the punchline can be empty for a one-liner)');
    assert.ok(setup.length + punchline.length <= 90, `too long: "${setup} ${punchline}"`);
    assert.ok(!setups.has(setup), `told twice: "${setup}"`);
    setups.add(setup);
  }
});

test('the joke of the day changes at midnight Eastern and is the same all day', () => {
  // 2026-11-03 is Eastern Standard Time (UTC-5): midnight is 05:00 UTC.
  const before = jokeOfTheDay(Date.parse('2026-11-03T04:59:59Z'));
  const after = jokeOfTheDay(Date.parse('2026-11-03T05:00:00Z'));
  const evening = jokeOfTheDay(Date.parse('2026-11-04T04:00:00Z'));
  assert.notDeepEqual(before, after);
  assert.deepEqual(after, evening);
  assert.ok(JOKES.includes(after));
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
