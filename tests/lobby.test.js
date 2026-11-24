// The lobby: who's on the site and the casino's big wins, live (scripts/casino-feed.js, realtime/lobby.js, the
// dev server's twin in tools/local-rooms.mjs, the bank's announcer in utils/lobby-feed.js and the pretend bank).
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bigWin, cleanWin, addWins, counts, areaOf, ago, BIG_WIN, FEED_SIZE, GAMES } from '../scripts/casino-feed.js';
import { checkWins, lobbyVersionProblem } from '../realtime/lobby.js';
import { localLobby } from '../tools/local-rooms.mjs';
import { mockBank } from '../tools/mock-bank.mjs';
import { announceWins } from '../utils/lobby-feed.js';
import { signPayload } from '../utils/fever-ticket.js';
import { GAMES as BANK_GAMES } from '../utils/bank-rules.js';

const SECRET = 'a-test-secret-that-is-long-enough-for-hmac';
const NOW = 1_800_000_000_000;

test('every game the bank takes bets on has a name and a page in the feed', () => {
  for (const game of BANK_GAMES) assert.ok(GAMES[game] && GAMES[game].name && GAMES[game].href.startsWith('/pages/'), game);
});

test('a win goes in the feed from BIG_WIN clicks over the bet, and every Grand Jackpot does', () => {
  const base = { name: 'luke', game: 'craps', amount: 500 };
  assert.equal(bigWin({ ...base, payout: 500 + BIG_WIN - 1 }, NOW), null);
  assert.deepEqual(bigWin({ ...base, payout: 500 + BIG_WIN }, NOW), { name: 'luke', game: 'craps', won: BIG_WIN, jackpot: false, at: NOW });
  assert.equal(bigWin({ ...base, payout: 0 }, NOW), null);
  // A small jackpot on a 10-click spin still counts.
  const pot = bigWin({ name: 'carson', game: 'slots', amount: 10, payout: 300, windfall: 290 }, NOW);
  assert.equal(pot.jackpot, true);
  assert.equal(pot.won, 290);
  // Only the Slots have a jackpot.
  assert.equal(bigWin({ ...base, payout: 600, windfall: 100 }, NOW), null);
  // No name (an account that never clicked), no entry.
  assert.equal(bigWin({ ...base, name: undefined, payout: 5000 }, NOW), null);
});

test('the lobby only keeps wins that make sense', () => {
  const ok = { name: 'luke', game: 'poker', won: 900, jackpot: false, at: NOW };
  assert.deepEqual(cleanWin(ok), ok);
  for (const bad of [
    null, 'win', { ...ok, game: 'roulette' }, { ...ok, game: '__proto__' }, { ...ok, name: '' }, { ...ok, name: 'a\u0000b' },
    { ...ok, name: 'x'.repeat(41) }, { ...ok, won: 0 }, { ...ok, won: 1.5 }, { ...ok, won: 1e9 }, { ...ok, jackpot: 'yes' },
    { ...ok, at: -1 }, { ...ok, name: { $ne: null } },
  ]) assert.equal(cleanWin(bad), null, JSON.stringify(bad));
});

test('the feed is newest first and only so long', () => {
  let feed = [];
  for (let i = 0; i < FEED_SIZE + 5; i++) feed = addWins(feed, [{ name: `p${i}`, game: 'slots', won: 600, jackpot: false, at: NOW + i }]);
  assert.equal(feed.length, FEED_SIZE);
  assert.equal(feed[0].name, `p${FEED_SIZE + 4}`);
  assert.ok(feed.every((w, i) => i === 0 || feed[i - 1].at >= w.at));
  assert.equal(addWins(feed, [{ junk: true }]).length, FEED_SIZE);
});

test('counts, areas and how long ago', () => {
  assert.deepEqual(counts(['site', 'casino', 'casino']), { t: 'here', here: 3, casino: 2 });
  assert.equal(areaOf('/pages/games/slots.html'), 'casino');
  assert.equal(areaOf('/pages/casino.html'), 'casino');
  assert.equal(areaOf('/pages/games/flappy.html'), 'site');
  assert.equal(areaOf('/'), 'site');
  assert.equal(ago(NOW - 10e3, NOW), 'just now');
  assert.equal(ago(NOW - 60e3, NOW), '1 minute ago');
  assert.equal(ago(NOW - 3 * 3600e3, NOW), '3 hours ago');
  assert.equal(ago(NOW - 2 * 864e5, NOW), '2 days ago');
});

test('the Worker only takes wins the bank signed, and only fresh ones', async () => {
  const wins = [{ name: 'luke', game: 'blackjack', won: 750, jackpot: false, at: NOW }];
  const payload = JSON.stringify({ wins, ts: NOW });
  const sig = await signPayload(payload, SECRET);
  assert.deepEqual(await checkWins({ payload, sig }, SECRET, NOW + 1000), wins);
  assert.equal(await checkWins({ payload, sig }, 'another-secret-that-is-long-enough-too', NOW), null);
  assert.equal(await checkWins({ payload, sig }, SECRET, NOW + 120000), null);
  assert.equal(await checkWins({ payload: payload.replace('750', '75000'), sig }, SECRET, NOW), null);
  assert.equal(await checkWins(null, SECRET, NOW), null);
  // Signed, but a junk entry is dropped rather than passed on.
  const mixed = JSON.stringify({ wins: [...wins, { name: 'x', game: 'nope', won: 1, at: NOW }], ts: NOW });
  assert.deepEqual(await checkWins({ payload: mixed, sig: await signPayload(mixed, SECRET) }, SECRET, NOW), wins);
  assert.equal(lobbyVersionProblem('1'), null);
  assert.match(lobbyVersionProblem('0'), /reload/);
});

test('the bank tells the lobby about wins, signed, and does nothing while online play is off', async () => {
  const wins = [{ name: 'luke', game: 'slots', won: 2000, jackpot: true, at: NOW }];
  const calls = [];
  const post = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  delete process.env.FEVER_ROOMS_URL;
  assert.equal(await announceWins(wins, { fetch: post, now: NOW }), false);
  assert.equal(calls.length, 0);

  process.env.FEVER_ROOMS_URL = 'wss://trusty-fever.example.workers.dev';
  process.env.FEVER_SECRET = SECRET;
  try {
    assert.equal(await announceWins([], { fetch: post, now: NOW }), false);
    assert.equal(await announceWins(wins, { fetch: post, now: NOW }), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://trusty-fever.example.workers.dev/lobby/win');
    assert.deepEqual(await checkWins(JSON.parse(calls[0].init.body), SECRET, NOW), wins);
    // A lobby that's down never breaks a payout.
    assert.equal(await announceWins(wins, { fetch: async () => { throw new Error('down'); }, now: NOW }), false);
  } finally {
    delete process.env.FEVER_ROOMS_URL;
    delete process.env.FEVER_SECRET;
  }
});

function fakeConn() {
  const got = [];
  return { got, closed: null, send(text) { got.push(JSON.parse(text)); }, close(code) { this.closed = code; } };
}

test('the local lobby says hello, counts who comes and goes, and passes wins on', async () => {
  const lobby = localLobby({ every: 5 });
  const a = fakeConn();
  const b = fakeConn();
  lobby.join(a, 'casino');
  assert.deepEqual(a.got[0], { t: 'lobby', here: 1, casino: 1, wins: [] });
  lobby.join(b, 'nonsense');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(a.got.at(-1), { t: 'here', here: 2, casino: 1 });
  const win = { name: 'luke', game: 'craps', won: 3500, jackpot: false, at: NOW };
  lobby.win([win]);
  assert.deepEqual(b.got.at(-1), { t: 'win', wins: [win] });
  lobby.leave(b);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(a.got.at(-1), { t: 'here', here: 1, casino: 1 });
  const c = fakeConn();
  lobby.join(c, 'site');
  assert.deepEqual(c.got[0].wins, [win]);
  lobby.receive(c, '{"t":"ping"}');
  assert.deepEqual(c.got.at(-1), { t: 'pong' });
  lobby.receive(c, '{"t":"spam"}');
  assert.equal(c.closed, 1008);
});

test('the pretend bank reports big wins as it pays them', async () => {
  const told = [];
  const bank = mockBank({ delay: 0, onWins: (wins) => told.push(...wins) });
  await bank.stake({ userId: 'mock-luke', betId: 'a1', amount: 500, game: 'craps' });
  await bank.stake({ userId: 'mock-luke', betId: 'a2', amount: 100, game: 'craps' });
  await bank.settle([{ userId: 'mock-luke', betId: 'a1', payout: 2000 }, { userId: 'mock-luke', betId: 'a2', payout: 200 }]);
  assert.equal(told.length, 1);
  assert.equal(told[0].name, 'luke');
  assert.equal(told[0].won, 1500);
  await bank.settle([{ userId: 'mock-luke', betId: 'a1', payout: 2000 }]); // a retry pays (and tells) nothing
  assert.equal(told.length, 1);
});
