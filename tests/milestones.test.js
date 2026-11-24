// The header clicker's click ranks, daily bonus and tiredness (scripts/milestones.js), the leaderboard page's list of
// them, and api/clicks.js's update for a press.
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  RANKS, rankFor, nextRank, rankProgress, rankLevel,
  DAILY, dayOf, dayBefore, dailyBonus, dailyClaim, dailyStatus,
  CLICKER, CLICKER_LAST, pressPays, pressesPaid, pressesToday, tiredness,
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

test('Trusty gets tired: full pay, then one in CLICKER.every, then nothing', () => {
  assert.ok(CLICKER.full > 0 && CLICKER.every > 1 && CLICKER.max > CLICKER.full);
  let paid = 0;
  for (let n = 1; n <= CLICKER_LAST + 1000; n++) {
    if (pressPays(n)) paid++;
    if (n % 997 === 0 || n === CLICKER.full || n === CLICKER_LAST) assert.equal(pressesPaid(n), paid, `${n} presses`);
  }
  assert.equal(paid, CLICKER.max, 'a whole day of presses pays CLICKER.max');
  assert.equal(pressesPaid(CLICKER.full), CLICKER.full);
  assert.equal(pressesPaid(CLICKER_LAST), CLICKER.max);
  assert.ok(pressPays(CLICKER_LAST) && !pressPays(CLICKER_LAST + CLICKER.every));
  assert.ok(!pressPays(CLICKER.full + 1) && pressPays(CLICKER.full + CLICKER.every));
  assert.ok(!pressPays(0) && !pressPays(-1) && !pressPays(1.5) && !pressPays('3'));
  assert.equal(tiredness(CLICKER.full - 1), 'fresh');
  assert.equal(tiredness(CLICKER.full), 'tired');
  assert.equal(tiredness(CLICKER_LAST), 'done');
  assert.equal(pressesToday({ day: '2026-11-24', n: 12 }, '2026-11-24'), 12);
  assert.equal(pressesToday({ day: '2026-11-23', n: 12 }, '2026-11-24'), 0, 'a new day starts over');
  assert.equal(pressesToday(null, '2026-11-24'), 0);
  // An autoclicker at the server's limit all day (6 a second) gets CLICKER.max, not half a million.
  assert.equal(pressesPaid(6 * 86400), CLICKER.max);
});

// Just enough of MongoDB's aggregation expressions to run api/clicks.js's update pipeline, so the test can check it
// pays the way pressPays() says without a database.
function evaluate(expr, doc) {
  if (typeof expr === 'string' && expr.startsWith('$')) return expr.slice(1).split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
  if (Array.isArray(expr)) return expr.map((e) => evaluate(e, doc));
  if (!expr || typeof expr !== 'object' || expr instanceof Date) return expr;
  const [op, ...rest] = Object.keys(expr);
  if (!op.startsWith('$')) return Object.fromEntries(Object.entries(expr).map(([k, v]) => [k, evaluate(v, doc)]));
  assert.equal(rest.length, 0, 'one operator per expression');
  if (op === '$literal') return expr.$literal;
  // $cond only works out the branch it takes, as MongoDB does.
  if (op === '$cond') return evaluate(expr.$cond[evaluate(expr.$cond[0], doc) ? 1 : 2], doc);
  const args = (Array.isArray(expr[op]) ? expr[op] : [expr[op]]).map((a) => evaluate(a, doc));
  const num = (v) => { assert.equal(typeof v, 'number', `${op} gets numbers`); return v; };
  switch (op) {
    case '$and': return args.every(Boolean);
    case '$or': return args.some(Boolean);
    case '$eq': return args[0] === args[1];
    case '$gt': return args[0] != null && args[0] > args[1];
    case '$lte': return args[0] != null && args[0] <= args[1];
    case '$add': return args.reduce((a, b) => num(a) + num(b));
    case '$subtract': return num(args[0]) - num(args[1]);
    case '$mod': return num(args[0]) % num(args[1]);
    case '$ifNull': return args[0] ?? args[1];
    case '$slice': return args[0].slice(0, args[1]);
    case '$concatArrays': return args.flat(1);
    default: throw new Error(`the test doesn't know ${op}`);
  }
}
const runPipeline = (pipeline, doc) => pipeline.reduce((d, stage) => ({ ...d, ...evaluate(stage.$set, d) }), doc);

test('api/clicks.js pays a press the way pressPays() says', async () => {
  const { pressUpdate } = await import('../api/clicks.js');
  const today = '2026-11-24';
  const now = new Date('2026-11-24T15:00:00Z');
  const name = '$weird.name';
  // An account from before presses were counted, and one with yesterday's count.
  for (const start of [{ clicks: 40 }, { clicks: 40, clicker: { day: '2026-11-23', n: 99999 }, recent: [now, now, now] }]) {
    const doc = runPipeline(pressUpdate(now, today, name), start);
    assert.deepEqual(doc.clicker, { day: today, n: 1 }, 'the first press of the day starts the count over');
    assert.equal(doc.clicks, 41);
    assert.equal(doc.username, name, 'a username is never read as a field path');
    assert.ok(doc.recent.length >= 1 && doc.recent.length <= 6 && doc.recent[0] === now);
  }
  for (const n of [1, 2, CLICKER.full - 1, CLICKER.full, CLICKER.full + 1, CLICKER.full + CLICKER.every - 1, CLICKER.full + CLICKER.every,
    CLICKER_LAST - 1, CLICKER_LAST, CLICKER_LAST + 1, CLICKER_LAST + CLICKER.every]) {
    const before = { clicks: 500, clicker: { day: today, n: n - 1 }, recent: [now, now, now, now, now, now] };
    const after = runPipeline(pressUpdate(now, today, 'carson'), before);
    assert.equal(after.clicker.n, n);
    assert.equal(after.clicks - before.clicks, pressPays(n) ? 1 : 0, `press ${n}`);
    assert.equal(after.recent.length, 6, 'only the last six presses are kept');
  }
});

test('pages/leaderboard.html says how Trusty gets tired', () => {
  const html = fs.readFileSync(new URL('pages/leaderboard.html', root), 'utf8');
  const rule = /<p[^>]* id="clicker-rule"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(rule, 'pages/leaderboard.html doesn’t explain the clicker’s daily limit (id="clicker-rule")');
  const fmt = (n) => n.toLocaleString('en-US');
  for (const part of [fmt(CLICKER.full), `1 in every ${CLICKER.every}`, fmt(CLICKER.max)]) {
    assert.ok(rule[1].includes(part), `the clicker line says "${part}"`);
  }
});
