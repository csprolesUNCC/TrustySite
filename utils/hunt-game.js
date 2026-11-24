import {
  importHunt, cleanCoords, cleanStart, isOn, viewFor, current, steps, stepStates, opensAt, intermission, signalHints,
  broadcastAt, mapOf, readMap, distance, newCode, codeHash, hashOf, normalize, BAND, CHECKS, GUESSES, REDEEMS, DAY_MS,
} from './hunt-rules.js';

// The real-world hunt's API, with no database or Vercel code: utils/hunt.js serves it as ?action=hunt on
// api/leaderboard.js with the hunt in MongoDB, and tools/dev-server.mjs and the tests run it with one in memory
// (utils/hunt-store.js). `request` is { method, query, body, user (the login, or null), admin, ip, now }; the answer
// is [status, body, cache], where cache 'public' means the CDN may keep it for a minute (it's the same for everyone).
//
//   GET  &do=tv&ch=<channel>&m=<minute>   public: Trusty TV's intermission that minute, if any (only for about now).
//   GET  &do=tv&test=1&ch=                admins: one in 3 seconds, to see what it looks like.
//   GET  &do=radio&mhz=<frequency>        what Trusty Radio picks up there: a broadcast only for players who've
//                                         reached the stage it belongs to (and admins).
//   GET                                   the Hayloft for a player who's been through the door ([&preview=1] for admins:
//                                         every page, whatever the date).
//   POST { do: 'door', slug }             the address typed after /h/. Wrong is a 404, like any page that isn't there.
//   POST { do: 'answer', stage, answer }  a step's answer.
//   POST { do: 'check', lat, lng }        the geochecker, for the last step: CHECKS tries a day.
//   POST { do: 'redeem', code }           a card from the box: one per player. The first pays rewards.first.
//   Admins: GET &do=admin (how it's going), POST { do: 'import', hunt }, { do: 'coords', lat, lng } (or clear),
//   { do: 'launch', startsAt, live }, { do: 'codes', count } (new cards; the only time their codes are shown),
//   { do: 'void' } (unused codes stop working), { do: 'reset-me' } (start over yourself, for testing).

const HOUR = 60 * 60 * 1000;
const MAX_CODES = 50;
const notFound = [404, { error: 'Not found' }];
const tooMany = (what) => [429, { error: `That's a lot of ${what}. Have a think and try again later.` }];

const userKey = (user) => String(user.userId);

async function hayloft(store, hunt, user, now, preview = false) {
  const progress = await store.progress(userKey(user));
  const view = viewFor(hunt, progress, now, { preview });
  const { solved, finders } = await store.stats();
  view.board = { solved: steps(hunt).map((s) => solved[s.id] || 0), finders };
  view.rewards = hunt.rewards;
  const step = current(hunt, progress, now);
  if (step && step.id === 'final') {
    view.checks = Math.max(0, CHECKS.perAccount - await store.count(`hunt:check:${userKey(user)}`, DAY_MS, now));
  }
  return view;
}

async function solveStep(store, hunt, user, id, now) {
  const fresh = await store.solve(userKey(user), user.username, id, now);
  if (!fresh || !hunt.rewards.stage) return null;
  return store.pay(userKey(user), user.username, `hunt:${id}`, hunt.rewards.stage);
}

async function tv(store, hunt, { query, admin, now }) {
  const ch = String(query.ch || '');
  if (query.test) {
    if (!admin || !hunt) return [403, { error: 'Admins only' }];
    const cards = hunt.signal.cards.filter((card) => card.channel === ch);
    const card = cards[0] || hunt.signal.cards[0];
    return [200, { on: true, air: { at: now + 3000, ms: hunt.signal.ms, card: { text: card.text, ...(card.mark ? { mark: card.mark } : {}) } }, hints: [] }];
  }
  const minute = Number(query.m);
  const nowMinute = Math.floor(now / 60000);
  // Only about now: asking for the rest of the week would show every card without watching any of it.
  if (!Number.isSafeInteger(minute) || minute < nowMinute - 1 || minute > nowMinute + 2) return [400, { error: 'Bad minute' }];
  if (!isOn(hunt, now)) return [200, { on: false }, 'public'];
  return [200, { on: true, air: intermission(hunt, ch, minute, now), hints: signalHints(hunt, now) }, 'public'];
}

async function radio(store, hunt, { query, user, admin, now }) {
  const mhz = Number(query.mhz);
  if (!(mhz >= BAND.low && mhz <= BAND.high)) return [400, { error: 'Not on the dial' }];
  if (!user || !hunt) return [200, { broadcast: null }];
  const progress = await store.progress(userKey(user));
  const preview = admin && query.preview;
  for (const { step, open, ready } of stepStates(hunt, progress && progress.solved, now, preview)) {
    if (!open || !ready || !step.radio) continue;
    const broadcast = broadcastAt(step, mhz);
    if (broadcast) return [200, { broadcast }];
  }
  return [200, { broadcast: null }];
}

async function adminStatus(store, hunt, now) {
  if (!hunt) return [200, { hunt: null }];
  const [{ solved, finders }, codes] = await Promise.all([store.stats(), store.codeCounts()]);
  const map = mapOf(hunt);
  const back = map && readMap(map, hunt.key);
  return [200, {
    hunt: {
      title: hunt.title, live: hunt.live, startsAt: hunt.startsAt, on: isOn(hunt, now), rewards: hunt.rewards,
      coords: hunt.coords, radius: hunt.final.radius, note: hunt.final.note, firstFinder: hunt.firstFinder,
      // The map, read back with the answers: if this doesn't match the coordinates, solvers would end up elsewhere.
      mapOk: Boolean(back && Math.abs(back.lat - hunt.coords.lat) < 1e-6 && Math.abs(back.lng - hunt.coords.lng) < 1e-6),
      cards: hunt.signal.cards.length, every: hunt.signal.every,
      steps: steps(hunt).map((s) => ({
        id: s.id, title: s.title, day: s.day, solved: solved[s.id] || 0,
        opensAt: hunt.startsAt ? new Date(opensAt(hunt, s)).toISOString() : null,
        ...(s.radio ? { mhz: s.radio.mhz } : {}),
      })),
      codes, finders,
    },
  }];
}

async function adminPost(store, hunt, body, user, now) {
  switch (body.do) {
    case 'import': {
      let doc;
      try { doc = importHunt(body.hunt, hunt); } catch (error) { return [400, { error: error.message }]; }
      await store.saveHunt(doc);
      return adminStatus(store, doc, now);
    }
    case 'coords': {
      if (!hunt) return [409, { error: 'Import the hunt first.' }];
      let coords = null;
      if (!body.clear) {
        try { coords = cleanCoords(body); } catch (error) { return [400, { error: error.message }]; }
      }
      const next = { ...hunt, coords };
      if (typeof body.note === 'string') {
        if (body.note.length > 1000) return [400, { error: 'Keep the note to 1000 characters.' }];
        next.final = { ...hunt.final, note: body.note.trim() };
      }
      if (body.radius !== undefined) {
        if (!Number.isSafeInteger(body.radius) || body.radius < 5 || body.radius > 500) return [400, { error: 'The radius is 5 to 500 m.' }];
        next.final = { ...next.final, radius: body.radius };
      }
      await store.saveHunt(next);
      return adminStatus(store, next, now);
    }
    case 'launch': {
      if (!hunt) return [409, { error: 'Import the hunt first.' }];
      let startsAt;
      try { startsAt = body.startsAt === undefined ? hunt.startsAt : cleanStart(body.startsAt); } catch (error) { return [400, { error: error.message }]; }
      const live = body.live === undefined ? hunt.live : body.live === true;
      if (live && !startsAt) return [400, { error: 'Pick when it starts before turning it on.' }];
      const next = { ...hunt, startsAt, live };
      await store.saveHunt(next);
      return adminStatus(store, next, now);
    }
    case 'codes': {
      if (!hunt) return [409, { error: 'Import the hunt first.' }];
      const count = body.count;
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX_CODES) return [400, { error: `Make 1 to ${MAX_CODES} at a time.` }];
      const codes = Array.from({ length: count }, newCode);
      await store.addCodes(codes.map((code) => codeHash(hunt.salt, code)), now);
      // Only their hashes are kept, so this is the one time anyone sees them.
      return [200, { codes, ...(await adminStatus(store, hunt, now))[1] }];
    }
    case 'void':
      await store.voidCodes();
      return adminStatus(store, hunt, now);
    case 'reset-me':
      await store.resetProgress(userKey(user));
      return adminStatus(store, hunt, now);
    default:
      return [400, { error: 'Unknown admin action' }];
  }
}

export async function handle(store, request) {
  const { method, query = {}, user = null, admin = false, ip = 'unknown', now = Date.now() } = request;
  const body = request.body && typeof request.body === 'object' ? request.body : {};

  if (method === 'GET') {
    if (query.do === 'admin') return admin ? adminStatus(store, await store.hunt(true), now) : [403, { error: 'Admins only' }];
    const hunt = await store.hunt();
    if (query.do === 'tv') return tv(store, hunt, { query, admin, now });
    if (query.do === 'radio') return radio(store, hunt, { query, user, admin, now });
    if (!hunt) return notFound;
    if (!user) return [401, { error: 'Log in to climb up.' }];
    if (admin && query.preview) return [200, await hayloft(store, hunt, user, now, true)];
    const progress = await store.progress(userKey(user));
    if (!progress || !progress.solved.includes('door')) return notFound;
    return [200, await hayloft(store, hunt, user, now)];
  }
  if (method !== 'POST') return [405, { error: 'Method Not Allowed' }];

  if (admin && ['import', 'coords', 'launch', 'codes', 'void', 'reset-me'].includes(body.do)) {
    return adminPost(store, await store.hunt(true), body, user, now);
  }
  const hunt = await store.hunt();
  if (!hunt) return notFound;

  if (body.do === 'door') {
    if (typeof body.slug !== 'string' || body.slug.length > 200) return notFound;
    const ipKey = `hunt:door:${ip}`;
    if (await store.count(ipKey, HOUR, now) >= GUESSES.perIp) return tooMany('doors');
    if (!isOn(hunt, now) || hashOf(hunt.salt, body.slug) !== hunt.door) {
      if (normalize(body.slug)) await store.hit(ipKey, HOUR, now);
      return notFound;
    }
    if (!user) return [200, { ok: true, login: true }];
    const reward = await solveStep(store, hunt, user, 'door', now);
    return [200, { ok: true, reward, hayloft: await hayloft(store, hunt, user, now) }];
  }

  if (!user) return [401, { error: 'Log in first.' }];
  const me = userKey(user);
  const progress = await store.progress(me);

  if (body.do === 'answer') {
    if (typeof body.stage !== 'string' || typeof body.answer !== 'string' || body.answer.length > 300) return [400, { error: 'Invalid answer' }];
    const step = current(hunt, progress, now);
    if (!step || step.id !== body.stage || step.id === 'door' || step.id === 'final') return [409, { error: 'That page isn’t open for you.' }];
    const keys = [`hunt:answer:${me}:${step.id}`, `hunt:answer-ip:${ip}`];
    if (await store.count(keys[0], HOUR, now) >= GUESSES.perAccount || await store.count(keys[1], HOUR, now) >= GUESSES.perIp) return tooMany('guesses');
    if (!normalize(body.answer)) return [400, { error: 'Write an answer first.' }];
    if (hashOf(hunt.salt, body.answer) !== step.hash) {
      await Promise.all(keys.map((k) => store.hit(k, HOUR, now)));
      return [200, { ok: false }];
    }
    const reward = await solveStep(store, hunt, user, step.id, now);
    return [200, { ok: true, reward, hayloft: await hayloft(store, hunt, user, now) }];
  }

  if (body.do === 'check') {
    const step = current(hunt, progress, now);
    if (!step || step.id !== 'final') return [409, { error: 'The map isn’t yours to check yet.' }];
    if (!hunt.coords) return [409, { error: 'Trusty hasn’t finished drawing the map. Check back soon.' }];
    let guess;
    try { guess = cleanCoords(body); } catch (error) { return [400, { error: error.message }]; }
    const keys = [`hunt:check:${me}`, `hunt:check-ip:${ip}`];
    const used = await store.count(keys[0], DAY_MS, now);
    if (used >= CHECKS.perAccount || await store.count(keys[1], DAY_MS, now) >= CHECKS.perIp) {
      return [429, { error: 'That’s today’s tries. The map will still be here tomorrow.', checks: 0 }];
    }
    if (distance(guess, hunt.coords) > hunt.final.radius) {
      await Promise.all(keys.map((k) => store.hit(k, DAY_MS, now)));
      return [200, { ok: false, checks: CHECKS.perAccount - used - 1 }];
    }
    const reward = await solveStep(store, hunt, user, 'final', now);
    return [200, { ok: true, reward, hayloft: await hayloft(store, hunt, user, now) }];
  }

  if (body.do === 'redeem') {
    if (typeof body.code !== 'string' || body.code.length > 60) return [400, { error: 'That’s not a code.' }];
    const ipKey = `hunt:redeem:${ip}`;
    if (await store.count(ipKey, HOUR, now) >= REDEEMS.perIp) return tooMany('codes');
    if (normalize(body.code).length !== 12) return [400, { error: 'A code is 12 letters and numbers, like ABCD-EFGH-JKMN.' }];
    const hash = codeHash(hunt.salt, body.code);
    const claimed = await store.claimCode(hash, me, user.username, now);
    if (claimed === 'none') {
      await store.hit(ipKey, HOUR, now);
      return [404, { error: 'That code isn’t one of Trusty’s. Check it against the card.' }];
    }
    if (claimed === 'used') return [409, { error: 'Someone already took that card. Take another one from the box.' }];
    if (claimed === 'mine') return [409, { error: 'You’ve already found it! Leave the other cards for the next person.' }];
    const first = await store.claimFirst(user.username);
    const amount = first ? hunt.rewards.first : hunt.rewards.finder;
    let reward;
    try {
      reward = await store.pay(me, user.username, 'hunt:found', amount);
    } catch (error) {
      await store.releaseCode(hash); // the card can be used again rather than wasted
      throw error;
    }
    await store.setFound(me, now);
    return [200, { ok: true, first, reward }];
  }

  return [400, { error: 'Unknown action' }];
}
