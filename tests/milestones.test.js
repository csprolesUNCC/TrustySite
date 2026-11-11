// The header clicker's click ranks and daily bonus (scripts/milestones.js), and the leaderboard page's list of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  RANKS, rankFor, nextRank, rankProgress, rankLevel,
  DAILY, dayOf, dayBefore, dailyBonus, dailyClaim, dailyStatus,
} from '../scripts/milestones.js';

const root = new URL('../', import.meta.url);

test('ranks have names and go up in order', () => {
  assert.ok(RANKS.length > 1);
  RANKS.forEach((rank, i) => {
    assert.ok(typeof rank.name === 'string' && rank.name.trim() === rank.name && rank.name, `rank ${i + 1} has a name`);
    assert.ok(Number.isSafeInteger(rank.at) && rank.at > 0, `${rank.name} is reached at a whole number of clicks`);
    if (i) assert.ok(rank.at > RANKS[i - 1].at, `${rank.name} comes after ${RANKS[i - 1].name}`);
  });
  assert.equal(new Set(RANKS.map((rank) => rank.name)).size, RANKS.length, 'no two ranks share a name');
});

test('rankFor(), nextRank() and rankProgress()', () => {
  const [first, second] = RANKS;
  const last = RANKS[RANKS.length - 1];
  assert.equal(rankFor(0), null);
  assert.equal(rankFor(first.at - 1), null);
  assert.equal(rankFor(first.at), first);
  assert.equal(rankFor(second.at - 1), first);
  assert.equal(rankFor(second.at), second);
  assert.equal(rankFor(last.at * 10), last);
  assert.equal(rankFor(NaN), null);
  assert.equal(nextRank(0), first);
  assert.equal(nextRank(first.at), second);
  assert.equal(nextRank(last.at), null, 'nothing after the top');
  assert.equal(rankProgress(0), 0);
  assert.equal(rankProgress(first.at / 2), 0.5);
  assert.equal(rankProgress(first.at), 0, 'a new rank starts the ring over');
  assert.equal(rankProgress((first.at + second.at) / 2), 0.5);
  assert.equal(rankProgress(last.at), 1);
  assert.equal(rankProgress(-50), 0);
  assert.deepEqual(RANKS.map(rankLevel), RANKS.map((_, i) => i + 1));
});

test('a new day starts at midnight Eastern', () => {
  // 2026-11-11 is Eastern Standard Time (UTC-5): midnight is 05:00 UTC. July is daylight time (UTC-4).
  assert.equal(dayOf(Date.parse('2026-11-11T04:59:59Z')), '2026-11-10');
  assert.equal(dayOf(Date.parse('2026-11-11T05:00:00Z')), '2026-11-11');
  assert.equal(dayOf(Date.parse('2026-07-01T03:59:59Z')), '2026-06-30');
  assert.equal(dayOf(Date.parse('2026-07-01T04:00:00Z')), '2026-07-01');
  assert.equal(dayBefore('2026-11-11'), '2026-11-10');
  assert.equal(dayBefore('2028-03-01'), '2028-02-29');
  assert.equal(dayBefore('2027-01-01'), '2026-12-31');
});

test('the daily bonus grows by DAILY.step a day, up to DAILY.max', () => {
  assert.equal(dailyBonus(1), DAILY.base);
  assert.equal(dailyBonus(2), DAILY.base + DAILY.step);
  assert.equal(dailyBonus(10000), DAILY.max);
  for (let streak = 1; streak < 100; streak++) {
    assert.ok(dailyBonus(streak + 1) >= dailyBonus(streak), `day ${streak + 1} pays at least day ${streak}`);
    assert.ok(Number.isSafeInteger(dailyBonus(streak)) && dailyBonus(streak) <= DAILY.max);
  }
});

test('dailyClaim() pays once a day, and the streak only carries on from yesterday', () => {
  const today = '2026-11-11';
  assert.deepEqual(dailyClaim(null, today), { streak: 1, added: DAILY.base }, 'the first one ever');
  assert.deepEqual(dailyClaim(undefined, today), { streak: 1, added: DAILY.base });
  assert.deepEqual(dailyClaim({ day: '2026-11-10', streak: 3 }, today), { streak: 4, added: dailyBonus(4) });
  assert.deepEqual(dailyClaim({ day: '2026-11-09', streak: 3 }, today), { streak: 1, added: DAILY.base }, 'missed a day');
  assert.equal(dailyClaim({ day: today, streak: 3 }, today), null, 'already paid today');
  assert.equal(dailyClaim({ day: today }, today), null, 'paid today, even without a streak count');
  assert.equal(dailyClaim({ day: '2026-11-12', streak: 1 }, today), null, 'paid by a clock that’s ahead');
});

test('dailyStatus() says whether the bonus is waiting and what the next one pays', () => {
  const today = '2026-11-11';
  assert.deepEqual(dailyStatus(null, today), { ready: true, streak: 0, next: DAILY.base });
  assert.deepEqual(dailyStatus({ day: '2026-11-10', streak: 3 }, today), { ready: true, streak: 3, next: dailyBonus(4) });
  assert.deepEqual(dailyStatus({ day: '2026-11-01', streak: 9 }, today), { ready: true, streak: 0, next: DAILY.base }, 'the streak is over');
  assert.deepEqual(dailyStatus({ day: today, streak: 4 }, today), { ready: false, streak: 4, next: dailyBonus(5) });
});

test('the leaderboard page lists the same ranks and daily bonus', () => {
  const html = fs.readFileSync(new URL('pages/leaderboard.html', root), 'utf8');
  const table = /<dl[^>]* id="rank-table"[^>]*>([\s\S]*?)<\/dl>/.exec(html);
  assert.ok(table, 'pages/leaderboard.html has no list of ranks (id="rank-table")');
  const names = [...table[1].matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
  const counts = [...table[1].matchAll(/<dd>([\d,]+)<\/dd>/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const levels = [...table[1].matchAll(/data-level="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(names, RANKS.map((rank) => rank.name));
  assert.deepEqual(counts, RANKS.map((rank) => rank.at));
  assert.deepEqual(levels, RANKS.map(rankLevel), 'each badge is colored for its rank');

  const rule = /<p[^>]* id="daily-rule"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(rule, 'pages/leaderboard.html doesn’t explain the daily bonus (id="daily-rule")');
  for (const part of [`+${DAILY.base} `, ` ${DAILY.step} more`, `+${DAILY.max}`]) {
    assert.ok(rule[1].includes(part), `the daily bonus line says "${part.trim()}"`);
  }
});
