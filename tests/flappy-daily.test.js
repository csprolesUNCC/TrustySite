import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { courseNumber, courseRandom, DAILY_TRIES } from '../scripts/flappy-daily.js';

test('a new course starts at midnight Eastern, daylight saving or not', () => {
  // 2026-11-04 is Eastern Standard Time (midnight = 05:00 UTC); 2027-07-04 is Daylight Time (04:00 UTC).
  assert.equal(courseNumber(Date.parse('2026-11-04T05:00:00Z')) - courseNumber(Date.parse('2026-11-04T04:59:59Z')), 1);
  assert.equal(courseNumber(Date.parse('2027-07-04T04:00:00Z')) - courseNumber(Date.parse('2027-07-04T03:59:59Z')), 1);
  assert.equal(courseNumber(Date.parse('2026-11-04T06:00:00Z')), courseNumber(Date.parse('2026-11-05T04:00:00Z')), 'same course all day');
});

test('every device gets the same pencils for a course, and a different set the next day', () => {
  const gaps = (n) => { const r = courseRandom(n); return Array.from({ length: 200 }, () => Math.floor(r() * 250) + 50); };
  assert.deepEqual(gaps(12), gaps(12));
  assert.notDeepEqual(gaps(12), gaps(13));
  for (const top of gaps(99)) assert.ok(top >= 50 && top < 300, `gap top ${top} out of the normal game's range`);
});

test('the daily board refuses bad flights before touching the database', async () => {
  const { default: flappyDaily } = await import('../utils/flappy-daily.js');
  const cookie = `authToken=${jwt.sign({ userId: 'u1', username: 'tester' }, process.env.JWT_SECRET)}`;
  const send = async (body, headers = { cookie }) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
    await flappyDaily({ method: 'POST', body, headers, query: { action: 'flappy-daily' } }, res);
    return res;
  };
  assert.equal((await send({ day: 1, score: 3 }, {})).statusCode, 401, 'logged out');
  for (const body of [{ day: courseNumber(), score: -1 }, { day: courseNumber(), score: 1.5 }, { day: courseNumber(), score: 1e9 },
    { day: courseNumber(), score: '5' }, { day: '1', score: 5 }, {}]) {
    assert.equal((await send(body)).statusCode, 400, JSON.stringify(body));
  }
  const stale = await send({ day: courseNumber() - 1, score: 5 });
  assert.equal(stale.statusCode, 409, 'yesterday’s course');
  assert.equal(stale.body.day, courseNumber());
  assert.ok(DAILY_TRIES >= 1);
});
