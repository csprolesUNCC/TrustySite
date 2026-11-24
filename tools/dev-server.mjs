// A local stand-in for Vercel with a pretend API, so every page renders (leaderboards, profiles, the Latest
// Update...) without MongoDB or any keys. For looking at the frontend and for tools/smoke.mjs; `vercel dev`
// is still the way to run the real API.
//   node tools/dev-server.mjs [port]        (npm run dev:mock)
// Log in by setting the cookie mock=in (tools/smoke.mjs does) plus the site's usual localStorage flag; the cookie
// mockuser=<name> picks who you are in the online rooms and at the Blackjack tables (carson otherwise), which
// run right here (tools/local-rooms.mjs) with a pretend click bank that forgets everything on restart
// (tools/mock-bank.mjs; everyone starts with 12,345 clicks). To try the real room server instead, run
// `npm run dev` in realtime/ and start this with FEVER_ROOMS_URL=ws://localhost:8790 and the FEVER_SECRET from
// realtime/.dev.vars: the room server then sends its bets here (SITE_URL, see realtime/package.json).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { attachRooms, localLobby, LOCAL_ROOMS_PATH } from './local-rooms.mjs';
import { mockBank } from './mock-bank.mjs';
import { signTicket } from '../utils/fever-ticket.js';
import { signedOp } from '../utils/bank-rules.js';
import { play as soloPlay, cleanMove, memoryGames, defaults as soloDefaults } from '../utils/solo-blackjack-game.js';
import { play as crapsPlay, cleanMove as crapsMove } from '../utils/solo-craps-game.js';
import { play as slotsPlay, cleanMove as slotsMove } from '../utils/solo-slots-game.js';
import { play as pokerPlay, cleanMove as pokerMove } from '../utils/solo-poker-game.js';
import { MACHINE as SLOT_MACHINE } from '../scripts/slots.js';
import { memoryJackpot } from '../utils/slots-jackpot.js';
import { puzzleNumber, cleanGame, rewardFor, rewardable } from '../scripts/trustle.js';
import { dayOf, dailyClaim, dailyStatus, CLICKER, CLICKER_LAST, pressPays, pressesToday } from '../scripts/milestones.js';
import { WATCH_REWARD } from '../scripts/tv-schedule.js';
import { GAME_REWARDS, payable } from '../scripts/game-rewards.js';
import { isHouse } from '../utils/house.js';
import { GAME_KEYS, POST_REWARD, parseShare, puzzleOn, rankOf, flagsFor } from '../scripts/daily-games.js';
import { puzzleWord } from '../scripts/trustle.js';
import { ITEMS, cleanOrder, equippedOf, nameStyleOf, ownedSet, isFree } from '../scripts/shop.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The headers vercel.json sends with every file.
const SECURITY_HEADERS = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))
  .headers.find((rule) => rule.source === '/(.*)').headers.map(({ key, value }) => [key, value]));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.glb': 'model/gltf-binary', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

const NAMES = ['carson', 'luke', 'hayhound', 'neigh_sayer', 'stickfig', 'pencilpusher', 'margins', 'tractorfan', 'mane_event', 'gallop'];
const board = (scoreKey, nameKey, top) => NAMES.map((name, i) => ({ [nameKey]: name, [scoreKey]: top - i * Math.round(top / 14) }));
const loggedIn = (req) => /(?:^|;\s*)mock=in(?:;|$)/.test(req.headers.cookie || '');
const mockUser = (req) => (/(?:^|;\s*)mockuser=([\w-]{1,32})(?:;|$)/.exec(req.headers.cookie || '') || [])[1] || 'carson';
const today = () => new Date().toISOString().slice(0, 10);
const FEVER_SECRET = process.env.FEVER_SECRET || 'pretend-api-secret-for-local-rooms-only';
const lobby = localLobby();
const bank = mockBank({ onWins: (wins) => lobby.win(wins) });
const accountOf = (req) => `mock-${mockUser(req)}`;
// Trusty Blackjack for one player (utils/solo-blackjack.js, the real game), kept in memory and betting the
// pretend bank.
const solo = { ...soloDefaults, ...memoryGames(), bank };
// Trusty Craps (utils/solo-craps.js, the real game), the same way.
const craps = { ...soloDefaults, ...memoryGames(), bank };
// Trusty Poker against the bots (utils/solo-poker.js, the real game), the same way.
const poker = { ...soloDefaults, ...memoryGames(), bank };
// Trusty Slots (utils/solo-slots.js, the real game), the same way. The cookie mockslots=bonus makes every spin
// win the Golden Horse bonus (the reels stop with a gold tile showing on each: stops 5, 6 and 7 of the Hay Day's
// strip), so there's a way to look at it without spinning 80 times; the free spins themselves stay random.
// mockslots=jackpot makes every spin win the Grand Jackpot, which starts here with a few thousand clicks in it.
const slots = { ...soloDefaults, ...memoryGames(), bank, jackpot: memoryJackpot() };
slots.jackpot.pot.cents = 743219;
const BONUS_STOPS = [5, 6, 7];
function slotsFor(req) {
  if (/(?:^|;\s*)mockslots=jackpot(?:;|$)/.test(req.headers.cookie || '')) return { ...slots, luck: () => 0 };
  if (!/(?:^|;\s*)mockslots=bonus(?:;|$)/.test(req.headers.cookie || '')) return slots;
  const stops = BONUS_STOPS.map((stop) => (stop + 0.5) / SLOT_MACHINE.strip.length);
  return { ...slots, random: () => (stops.length ? stops.shift() : slots.random()) };
}

// Trustle's clicks, paid like api/trustle-api.js pays them (once a puzzle, within a day of today's) into the
// pretend bank. It keeps no games, so only the ones a page sends can pay.
const trustlePaid = new Map();
function trustleSync(userId, body) {
  const sent = body && typeof body.games === 'object' && body.games ? body.games : {};
  if (!trustlePaid.has(userId)) trustlePaid.set(userId, {});
  const rewards = trustlePaid.get(userId);
  const account = bank.account(userId);
  let added = 0;
  for (const [key, game] of Object.entries(sent)) {
    const n = Number(key);
    const clicks = rewardable(n, puzzleNumber()) && !rewards[n] ? rewardFor(n, cleanGame(n, game)) : 0;
    if (!clicks) continue;
    rewards[n] = clicks;
    account.clicks += clicks;
    added += clicks;
  }
  return { games: {}, rewards, added, clicks: account.clicks };
}

// The Daily Games board (utils/daily.js), kept in memory and started with a few made-up results for today, read
// by the real parser (scripts/daily-games.js) so the samples are checked like anyone's paste.
const dailyScores = [];
let dailyId = 0;
function dailyPost(name, text) {
  const read = parseShare(text);
  if (read.error) return [400, { error: read.error }];
  if (dailyScores.some((s) => s.name === name && s.game === read.game && s.day === read.day)) {
    return [409, { error: 'You’ve already posted that one. The first result you post is the one that counts.' }];
  }
  const history = dailyScores.filter((s) => s.name === name && s.game === read.game).reverse().map((s) => s.result);
  const entry = { id: String(++dailyId).padStart(24, '0'), name, ...read, rank: rankOf(read.game, read.result), flags: flagsFor(read.game, read.result, history), reports: 0 };
  dailyScores.push(entry);
  return [201, { day: entry.day, entry }];
}
{
  const n = (game) => puzzleOn(game, dayOf());
  const W = { 3: '⬜🟨⬜⬜⬜\n🟩🟩⬜🟨⬜\n🟩🟩🟩🟩🟩', 4: '⬜⬜⬜⬜🟨\n⬜🟨⬜⬜⬜\n🟩🟩⬜🟩⬜\n🟩🟩🟩🟩🟩', 1: '🟩🟩🟩🟩🟩' };
  [['luke', 3], ['hayhound', 4], ['stickfig', 1], ['margins', 4]].forEach(([name, g]) => dailyPost(name, `Wordle ${n('wordle')} ${g}/6\n\n${W[g]}`));
  dailyPost('luke', `Connections\nPuzzle #${n('connections')}\n🟨🟨🟨🟨\n🟩🟦🟩🟩\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪`);
  dailyPost('gallop', `Connections\nPuzzle #${n('connections')}\n🟪🟪🟪🟪\n🟦🟦🟦🟦\n🟩🟩🟩🟩\n🟨🟨🟨🟨`);
  dailyPost('hayhound', `Krillion #${n('krillion')} 🦐\n300\n\n🌟🦑🐟🏮⬛🫧🤡`);
  dailyPost('neigh_sayer', `Krillion #${n('krillion')} 🦐\n🐟🐟🫧🦑⬛🤡🫧`);
  dailyPost('pencilpusher', 'RNGdle 🎲 805393\n\n⬜ COMMON • Bottom 7.5%\n\n⬜ 🏞️ Hills\n⬜ 🐫 Dunes\n⬜ 🦘 Hopscotch\n+8 more\n\n2,831 EP\nhttps://rngdle.com');
  dailyPost('gallop', 'RNGdle 🎲 777777\n\n🟪 EPIC • Top 0.05%\n\n🟪 🎰 Jackpot\n🟪 🪞 Mirror\n\n9,120 EP\nhttps://rngdle.com');
}
function dailyBoards() {
  const day = dayOf();
  const trustleN = puzzleNumber();
  const length = puzzleWord(trustleN).word.length;
  const row = (tiles) => tiles.padEnd(length, 'a').slice(0, length);
  const trustle = [
    { name: 'carson', result: { won: true, tries: 3, grid: [row('apa'), row('ccap'), 'c'.repeat(length)] } },
    { name: 'tractorfan', result: { won: true, tries: 5, grid: [row('a'), row('pa'), row('cpa'), row('ccpa'), 'c'.repeat(length)] } },
    { name: 'mane_event', result: { won: false, tries: 6, grid: Array.from({ length: 6 }, () => row('pc')) } },
  ];
  const boards = { trustle: { n: trustleN, entries: trustle } };
  for (const game of GAME_KEYS) {
    boards[game] = {
      n: puzzleOn(game, day),
      entries: dailyScores.filter((s) => s.game === game && s.day === day).sort((a, b) => a.rank - b.rank)
        .map(({ id, name, result, flags }) => ({ id, name, result, flags })),
    };
  }
  return { day, today: day, boards };
}

// The Item Shop (utils/shop.js), buying with the pretend bank's clicks. A few of the sample players have styled
// names, so the boards show some.
const SAMPLE_STYLES = {
  luke: { font: 'calligraphy', color: 'gilded' },
  hayhound: { highlight: 'yellow' },
  neigh_sayer: { font: 'blackletter', color: 'red' },
  stickfig: { color: 'rainbow', highlight: 'sparkle' },
  margins: { font: 'quill', color: 'blue', highlight: 'washi' },
  gallop: { font: 'bubble', color: 'hl-pink' },
};
const shopOf = (account) => (account.shop ||= { owned: [], equipped: {}, spent: 0 });
const shopAnswer = (account) => {
  const shop = shopOf(account);
  return { clicks: account.clicks, owned: [...ownedSet(shop.owned)], equipped: equippedOf(shop), spent: shop.spent };
};
function shopApi(req, url, body) {
  const names = url.searchParams.getAll('n');
  if (req.method === 'GET' && names.length) {
    const styles = {};
    for (const name of names) {
      const style = SAMPLE_STYLES[name] || nameStyleOf(bank.account(`mock-${name}`).shop);
      if (style) styles[name] = style;
    }
    return [200, { styles }];
  }
  if (!loggedIn(req)) return [401, { error: 'Log in to shop.' }];
  const account = bank.account(accountOf(req));
  if (req.method === 'GET') return [200, { ...shopAnswer(account), house: isHouse(mockUser(req)), items: ITEMS.length }];
  const order = cleanOrder(body);
  if (!order) return [400, { error: 'That’s not something the shop sells.' }];
  if (isHouse(mockUser(req))) return [403, { error: 'Trusty’s account is the house: it can’t shop.' }];
  const shop = shopOf(account);
  const { item } = order;
  if (order.do === 'equip') {
    if (!isFree(item) && !shop.owned.includes(item.id)) return [403, { error: `You don’t own ${item.name} yet.`, ...shopAnswer(account) }];
    if (isFree(item)) delete shop.equipped[item.kind];
    else shop.equipped[item.kind] = item.id;
    return [200, shopAnswer(account)];
  }
  if (shop.owned.includes(item.id)) return [409, { error: `You already have ${item.name}.`, ...shopAnswer(account) }];
  if (account.clicks < item.price) return [400, { error: `${item.name} costs ${item.price} clicks: you need ${item.price - account.clicks} more.`, ...shopAnswer(account) }];
  account.clicks -= item.price;
  shop.spent += item.price;
  shop.owned.push(item.id);
  shop.equipped[item.kind] = item.id;
  return [200, { ...shopAnswer(account), bought: item.id }];
}

// Flappy's, Trustis's and Snake's clicks for a finished game, paid like utils/game-rewards.js pays them (up to
// each game's daily cap) into the pretend bank. Saving a score is pretend: every game is a "new best".
function gameReward(req, game, body) {
  const score = body && body.score;
  if (!Number.isSafeInteger(score) || score < 0) return [400, { error: 'Invalid score' }];
  const account = bank.account(accountOf(req));
  const day = dayOf();
  account.games ||= {};
  const counted = account.games[game]?.day === day ? account.games[game].clicks : 0;
  const added = payable(game, score, counted);
  account.games[game] = { day, clicks: counted + added };
  account.clicks += added;
  return [201, { message: 'Score saved!', reward: { added, clicks: account.clicks, today: counted + added, cap: GAME_REWARDS[game].daily } }];
}

async function api(req, url, body) {
  const p = url.pathname;
  const action = url.searchParams.get('action');
  const me = loggedIn(req);
  if (p === '/api/auth/login') return me ? [200, { isLoggedIn: true, username: 'carson', isAdmin: true }] : [401, { isLoggedIn: false }];
  if (p === '/api/auth/logout') return [200, { message: 'Logged out' }];
  if (p.startsWith('/api/auth/')) return [400, { message: 'The pretend API doesn’t do accounts.' }];
  if (p === '/api/clicks') {
    if (!me) return [401, { error: 'Authentication required' }];
    const account = bank.account(accountOf(req));
    if (req.method !== 'POST') {
      const shop = shopOf(account);
      return [200, { clicks: account.clicks, clicker: { day: dayOf(), n: pressesToday(account.clicker, dayOf()) }, daily: dailyStatus(account.daily, dayOf()), shop: { theme: equippedOf(shop).theme, style: nameStyleOf(shop) } }];
    }
    if (action === 'tv' || action === 'radio') {
      // Trusty TV's and Trusty Radio's rewards, sharing one daily cap, as api/clicks.js pays them.
      const { clicks, daily: cap } = WATCH_REWARD;
      const day = dayOf();
      const counted = account.watch?.day === day ? account.watch.clicks : 0;
      if (counted + clicks > cap) return [429, { error: 'That’s today’s clicks.', capped: true, day, today: counted, cap }];
      account.watch = { day, clicks: counted + clicks };
      account.clicks += clicks;
      return [200, { clicks: account.clicks, added: clicks, today: counted + clicks, cap }];
    }
    // A press, and the daily bonus with the day's first one, as api/clicks.js pays them: a click while Trusty's
    // fresh, one in CLICKER.every once he's tired, none once he's done for the day.
    const day = dayOf();
    // The cookie mockclicker=tired or =done starts the day's count where Trusty gets tired or is done, to look at them.
    const preset = /(?:^|;\s*)mockclicker=(tired|done)(?:;|$)/.exec(req.headers.cookie || '');
    if (preset && !pressesToday(account.clicker, day)) account.clicker = { day, n: preset[1] === 'done' ? CLICKER_LAST : CLICKER.full };
    const n = pressesToday(account.clicker, day) + 1;
    account.clicker = { day, n };
    const added = pressPays(n) ? 1 : 0;
    account.clicks += added;
    const press = { added, clicker: account.clicker };
    const claim = dailyClaim(account.daily, day);
    if (!claim) return [200, { clicks: account.clicks, ...press }];
    account.daily = { day, streak: claim.streak };
    account.clicks += claim.added;
    return [200, { clicks: account.clicks, daily: claim, ...press }];
  }
  if (p === '/api/leaderboard') {
    if (action === 'shop') return shopApi(req, url, body);
    if (action === 'update') return [200, { date: today(), headline: 'Pretend update!', text: 'This is tools/dev-server.mjs talking, not the real API.' }];
    if (action === 'fever') {
      const rooms = process.env.FEVER_ROOMS_URL || `ws://${req.headers.host}${LOCAL_ROOMS_PATH}`;
      if (req.method === 'GET') return [200, { rooms }];
      if (!me) return [401, { error: 'Authentication required' }];
      return [200, { rooms, ticket: await signTicket({ id: accountOf(req), name: mockUser(req) }, FEVER_SECRET) }];
    }
    if (action === 'bank') {
      if (req.method === 'GET') return me ? [200, bank.status(accountOf(req))] : [401, { error: 'Authentication required' }];
      // Bets from the real room server (realtime/, under `npm run dev`), signed like the real ones.
      const op = await signedOp(body, FEVER_SECRET);
      if (!op) return [403, { error: 'Not a request from the room server' }];
      if (op.op === 'stake') return [200, await bank.stake(op)];
      if (op.op === 'settle') return [200, await bank.settle(op.bets)];
      return [200, await bank.pot(op)];
    }
    if (action === 'blackjack') {
      if (!me) return [401, { error: 'Authentication required' }];
      const move = req.method === 'POST' ? cleanMove(body) : null;
      if (req.method === 'POST' && !move) return [400, { error: 'That’s not a move.' }];
      const game = await soloPlay(solo, accountOf(req), move);
      if (!move) {
        const mine = bank.status(accountOf(req));
        Object.assign(game, { bank: { clicks: mine.clicks, net: mine.net }, limits: mine.limits, refunded: 0 });
      }
      return [200, game];
    }
    if (action === 'craps') {
      if (!me) return [401, { error: 'Authentication required' }];
      const move = req.method === 'POST' ? crapsMove(body) : null;
      if (req.method === 'POST' && !move) return [400, { error: 'That’s not a bet.' }];
      const game = await crapsPlay(craps, accountOf(req), move);
      if (!move) {
        const mine = bank.status(accountOf(req));
        Object.assign(game, { bank: { clicks: mine.clicks, net: mine.net }, limits: mine.limits, refunded: 0 });
      }
      return [200, game];
    }
    if (action === 'slots') {
      if (!me) return [401, { error: 'Authentication required' }];
      const move = req.method === 'POST' ? slotsMove(body) : null;
      if (req.method === 'POST' && !move) return [400, { error: 'That’s not a spin.' }];
      const game = await slotsPlay(slotsFor(req), accountOf(req), move);
      if (!move) {
        const mine = bank.status(accountOf(req));
        Object.assign(game, { bank: { clicks: mine.clicks, net: mine.net }, limits: mine.limits, refunded: 0 });
      }
      return [200, game];
    }
    if (action === 'poker') {
      if (!me) return [401, { error: 'Authentication required' }];
      const move = req.method === 'POST' ? pokerMove(body) : null;
      if (req.method === 'POST' && !move) return [400, { error: 'That’s not a move.' }];
      const game = await pokerPlay(poker, accountOf(req), move);
      if (!move) {
        const mine = bank.status(accountOf(req));
        Object.assign(game, { bank: { clicks: mine.clicks, net: mine.net }, limits: mine.limits, refunded: 0 });
      }
      return [200, game];
    }
    if (action === 'daily') {
      if (req.method === 'GET') return [200, dailyBoards()];
      if (!me) return [401, { error: 'Log in to post your results.' }];
      if (body && body.do === 'report') return [201, { message: 'Reported' }];
      const [status, answer] = dailyPost(mockUser(req), body && body.text);
      if (status !== 201) return [status, answer];
      // Posting pays its clicks into the pretend bank, as utils/daily.js does.
      const account = bank.account(accountOf(req));
      account.clicks += POST_REWARD;
      return [status, { ...answer, reward: { added: POST_REWARD, clicks: account.clicks } }];
    }
    if ((action === 'trustis' || action === 'snake') && req.method === 'POST') {
      return me ? gameReward(req, action, body) : [401, { error: 'Authentication required' }];
    }
    if (action === 'trustis') return [200, url.searchParams.get('personal') ? { highScore: 5000 } : board('score', 'name', 90000)];
    if (action === 'snake') return [200, url.searchParams.get('personal') ? { highScore: 12 } : board('score', 'name', 140)];
    if (action === 'profile' && req.method === 'GET') {
      const u = url.searchParams.get('u') || 'carson';
      return [200, {
        username: u, memberSince: '2025-11-20T00:00:00Z', isMe: me && u === 'carson', rename: me && u === 'carson' ? { admin: true, next: null } : null,
        bio: 'Professional Trusty enjoyer.', clicks: isHouse(u) ? null : { total: 12345, rank: 3, streak: 4 }, flappy: { score: 42, rank: 2 }, draw: null,
        trustis: { score: 90000, rank: 1, lines: 120, level: 13 }, snake: { score: 40, rank: 4 },
        trustle: { played: 20, won: 18, streak: 4, best: 9, dist: [0, 2, 5, 6, 4, 1] }, tv: { trusty: 3600, snn: 600 },
        daily: { wordle: { played: 30, streak: 6, won: 29, average: 3.9, best: 2 }, connections: { played: 12, streak: 2, won: 10, perfect: 4 }, krillion: { played: 5, streak: 0, average: 310, best: 455 }, rngdle: { played: 8, streak: 3, average: 3410, best: 6020 } },
        bets: Object.fromEntries(Object.entries(bank.status(`mock-${u}`).month).filter(([, n]) => n)),
        house: isHouse(u) ? bank.house() : null,
      }];
    }
    if (action === 'admin') {
      if (!me) return [401, { error: 'Authentication required' }];
      const view = url.searchParams.get('view');
      if (view === 'daily') return [200, { results: dailyScores.filter((s) => s.flags.length).map((s) => ({ ...s, at: new Date().toISOString() })) }];
      if (view === 'users') return [200, { users: NAMES.map((username, i) => ({ username, createdAt: new Date(Date.now() - i * 864e5).toISOString(), flags: [] })) }];
      return [200, { drawings: [] }];
    }
    if (req.method !== 'GET') return [200, {}];
    return [200, board('clicks', 'username', 50000)];
  }
  if (p === '/api/flappy-api' && req.method === 'POST') return me ? gameReward(req, 'flappy', body) : [401, { error: 'Auth required' }];
  if (p === '/api/flappy-api') return [200, action === 'personal' ? { highScore: 12 } : board('score', 'name', 60)];
  if (p === '/api/draw-api') {
    if (action === 'get_personal') return [200, { highScore: 70 }];
    if (action === 'get_leaderboard') return [200, board('score', 'name', 92).map((e, i) => ({ ...e, drawing: null, id: `${i}`.padStart(24, '0'), at: new Date().toISOString() }))];
    return [200, { message: 'Score saved!', score: 50 }];
  }
  if (p === '/api/trustle-api') {
    if (req.method === 'GET') return [200, { players: 40, dist: [1, 4, 10, 12, 8, 3], lost: 2 }];
    return [200, me ? trustleSync(accountOf(req), body) : { games: {} }];
  }
  if (p === '/api/gemini') return [200, { reply: 'whaddup. (This is the pretend API: run `vercel dev` to talk to the real Trusty.)' }];
  return [404, { error: 'Not found' }];
}

export function startServer(port = 8787) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    res.setHeader('Date', new Date().toUTCString());
    if (url.pathname.startsWith('/api/')) {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', async () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
        const [status, body] = await api(req, url, parsed);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
      });
      return;
    }
    if (url.pathname.startsWith('/_vercel/')) { // Vercel Analytics only exists on Vercel
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end('');
      return;
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    let status = 200;
    const rel = path.relative(ROOT, file);
    if (!fs.existsSync(file) || /(^|\/)(node_modules|\.git|\.github|api|utils|tests|tools|realtime)(\/|$)/.test(rel)
      || /^(package(-lock)?\.json|vercel\.json|\.vercelignore|\.gitignore|README\.md|CLAUDE\.md)$/.test(rel)) { // as vercel.json's redirects
      status = 404;
      file = path.join(ROOT, '404.html');
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    let data = fs.readFileSync(file);
    // The same security headers vercel.json sends, so the smoke test catches a page they'd break.
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS };
    if (/text|javascript|json|xml|svg/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && req.method !== 'HEAD') {
      data = zlib.gzipSync(data);
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
  attachRooms(server, FEVER_SECRET, bank, lobby);
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8787;
  await startServer(port);
  console.log(`Trusty da Horse (pretend API) on http://localhost:${port}`);
}
