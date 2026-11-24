import { createHash, randomBytes, randomInt } from 'node:crypto';

// The real-world hunt's rules, with no database (utils/hunt.js serves them; tools/dev-server.mjs and the tests
// run the same ones with a hunt kept in memory).
//
// The repo is public, so nothing here or anywhere in it says what a puzzle is or what its answer is: an admin
// imports the hunt (its pages, answers and timings) as JSON on the admin panel, and the server only keeps a
// salted hash of each answer. Coordinates are entered there too, whenever they're ready.
//
// A hunt is a chain: the door (an address, /h/<door>, worked out from Trusty TV's intermissions), then each of
// `stages` in order, then `final` (the map to the coordinates, checked with the geochecker), then the box itself,
// whose cards carry one-time codes. Each step only shows once the one before it is solved AND its own day has
// come (`day`: days after `startsAt`), so nobody can finish it faster than the calendar allows.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_STAGES = 8;
const ID = /^[a-z][a-z0-9-]{0,23}$/;
const RESERVED = new Set(['door', 'final']);
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const TEXT_MAX = 4000;
const IMAGE_MAX = 600 * 1024;
const CHANNELS = ['trusty', 'snn', 'spongebob', 'regularshow']; // scripts/tv-lineup.js's keys
export const BAND = { low: 88, high: 108 }; // Trusty Radio's dial (scripts/radio-lineup.js)

// How many tries the geochecker allows: per account and per IP address, each day.
export const CHECKS = { perAccount: 3, perIp: 10 };
// Guesses at one step, per account (and per IP address for the door) each hour.
export const GUESSES = { perAccount: 20, perIp: 60 };
export const REDEEMS = { perIp: 10 }; // codes typed in, per IP address each hour

export const DEFAULT_REWARDS = { stage: 1000, first: 25000, finder: 5000 };
export const MAX_REWARD = 100000;

/** An answer as it's compared: capitals, letters and digits only ("Over the hills!" is OVERTHEHILLS). */
export function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const hashOf = (salt, text) => createHash('sha256').update(`${salt}:${normalize(text)}`).digest('hex');

/* ---------- Importing a hunt (the admin panel) ---------- */

const isText = (v, max = TEXT_MAX) => typeof v === 'string' && v.length > 0 && v.length <= max;
const whole = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;

function cleanBody(body, where) {
  if (body === undefined) return [];
  if (!Array.isArray(body) || body.length > 40) throw new Error(`${where}: body must be a list of blocks`);
  return body.map((block, i) => {
    const at = `${where} block ${i + 1}`;
    if (typeof block === 'string') block = { p: block };
    if (!block || typeof block !== 'object') throw new Error(`${at}: not a block`);
    if (isText(block.p)) return { p: block.p };
    if (isText(block.h, 120)) return { h: block.h };
    if (isText(block.pre)) return { pre: block.pre };
    if (typeof block.img === 'string') {
      if (!IMAGE.test(block.img) || block.img.length > IMAGE_MAX) throw new Error(`${at}: img must be a PNG, JPEG or WebP data URL under 600 KB`);
      if (!isText(block.alt, 300)) throw new Error(`${at}: an img needs alt text`);
      return { img: block.img, alt: block.alt };
    }
    throw new Error(`${at}: use { p }, { h }, { pre } or { img, alt }`);
  });
}

function cleanHints(hints, where) {
  if (hints === undefined) return [];
  if (!Array.isArray(hints) || hints.length > 10) throw new Error(`${where}: hints must be a list`);
  return hints.map((hint, i) => {
    if (!hint || !whole(hint.day, 0, 365) || !isText(hint.text, 600)) throw new Error(`${where} hint ${i + 1}: needs { day, text }`);
    return { day: hint.day, text: hint.text };
  });
}

function cleanAnswer(answer, where) {
  const n = normalize(answer);
  if (n.length < 4 || n.length > 64) throw new Error(`${where}: the answer needs 4 to 64 letters or digits`);
  return n;
}

/**
 * Checks a hunt as an admin pasted it and turns it into what's stored: answers become salted hashes, and the
 * final map's key is every answer before it, in order. Throws an Error saying what's wrong.
 * `previous` is the stored hunt this replaces, if any: its salt, seed, coordinates, codes' salt and launch carry
 * over, so re-importing to fix a typo doesn't break codes already printed or progress already made.
 */
export function importHunt(input, previous = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The hunt must be a JSON object');
  const salt = previous?.salt || randomBytes(16).toString('hex');
  const seed = previous?.seed || randomBytes(16).toString('hex');
  const title = isText(input.title, 80) ? input.title : 'The Hayloft';

  const rewards = { ...DEFAULT_REWARDS };
  for (const key of Object.keys(DEFAULT_REWARDS)) {
    if (input.rewards && input.rewards[key] !== undefined) {
      if (!whole(input.rewards[key], 0, MAX_REWARD)) throw new Error(`rewards.${key} must be 0 to ${MAX_REWARD}`);
      rewards[key] = input.rewards[key];
    }
  }

  const signal = input.signal;
  if (!signal || !Array.isArray(signal.cards) || !signal.cards.length || signal.cards.length > 12) {
    throw new Error('signal.cards: list the intermission cards (1 to 12)');
  }
  const cards = signal.cards.map((card, i) => {
    const at = `signal card ${i + 1}`;
    if (!card || !CHANNELS.includes(card.channel)) throw new Error(`${at}: channel must be one of ${CHANNELS.join(', ')}`);
    if (!isText(card.text, 40)) throw new Error(`${at}: text must be 1 to 40 characters`);
    if (card.mark !== undefined && !isText(card.mark, 8)) throw new Error(`${at}: mark must be up to 8 characters`);
    return { channel: card.channel, text: card.text, ...(card.mark ? { mark: card.mark } : {}) };
  });
  const ms = signal.ms === undefined ? 450 : signal.ms;
  const every = signal.every === undefined ? 12 : signal.every;
  if (!whole(ms, 150, 3000)) throw new Error('signal.ms: how long a card shows, 150 to 3000 ms');
  if (!whole(every, 1, 240)) throw new Error('signal.every: minutes between cards on a channel, on average (1 to 240)');

  const door = cleanAnswer(input.door, 'door');
  const answers = [door];

  if (!Array.isArray(input.stages) || input.stages.length > MAX_STAGES) throw new Error(`stages: a list of up to ${MAX_STAGES}`);
  const ids = new Set();
  let lastDay = 0;
  const stages = input.stages.map((stage, i) => {
    const where = `stage ${i + 1}`;
    if (!stage || !ID.test(stage.id) || RESERVED.has(stage.id) || ids.has(stage.id)) {
      throw new Error(`${where}: id must be unique, lowercase letters, digits and dashes, and not door or final`);
    }
    ids.add(stage.id);
    if (!isText(stage.title, 80)) throw new Error(`${where}: needs a title`);
    if (!whole(stage.day, 0, 365) || stage.day < lastDay) throw new Error(`${where}: day must be 0 to 365 and not before the stage before it`);
    lastDay = stage.day;
    const answer = cleanAnswer(stage.answer, where);
    answers.push(answer);
    const out = {
      id: stage.id, title: stage.title, day: stage.day, body: cleanBody(stage.body, where),
      hints: cleanHints(stage.hints, where), hash: hashOf(salt, answer),
    };
    if (stage.radio !== undefined) {
      const { mhz, lines, rate } = stage.radio || {};
      if (typeof mhz !== 'number' || !(mhz >= BAND.low && mhz <= BAND.high) || Math.round(mhz * 10) !== mhz * 10) {
        throw new Error(`${where}: radio.mhz must be on the dial (${BAND.low} to ${BAND.high}, one decimal)`);
      }
      if (!Array.isArray(lines) || !lines.length || lines.length > 80 || !lines.every((l) => isText(l, 300))) {
        throw new Error(`${where}: radio.lines must be 1 to 80 lines of text`);
      }
      if (rate !== undefined && !(typeof rate === 'number' && rate >= 0.5 && rate <= 1.5)) throw new Error(`${where}: radio.rate must be 0.5 to 1.5`);
      out.radio = { mhz, lines: [...lines], rate: rate || 0.85 };
    }
    return out;
  });

  const final = input.final;
  if (!final || !isText(final.title, 80)) throw new Error('final: needs a title');
  if (!whole(final.day, 0, 365) || final.day < lastDay) throw new Error('final.day must be 0 to 365 and not before the last stage');
  const radius = final.radius === undefined ? 30 : final.radius;
  if (final.note !== undefined && (typeof final.note !== 'string' || final.note.length > 1000)) throw new Error('final.note: up to 1000 characters');
  if (!whole(radius, 5, 500)) throw new Error('final.radius: how close counts, 5 to 500 m');

  const hunt = {
    title, salt, seed, rewards,
    signal: { cards, ms, every, hints: cleanHints(signal.hints, 'signal') },
    door: hashOf(salt, door),
    doorLength: door.length,
    stages,
    final: {
      title: final.title, day: final.day, body: cleanBody(final.body, 'final'), hints: cleanHints(final.hints, 'final'),
      radius, note: final.note === undefined ? '' : final.note,
    },
    // The map is dealt with every answer before it, in order (see mapOf).
    key: answers.join(''),
    live: previous?.live || false,
    startsAt: previous?.startsAt || null,
    coords: previous?.coords || null,
    firstFinder: previous?.firstFinder || null,
  };
  if (input.coords !== undefined) hunt.coords = cleanCoords(input.coords);
  if (input.startsAt !== undefined) hunt.startsAt = cleanStart(input.startsAt);
  return hunt;
}

/** { lat, lng } with real numbers on the globe, or throws. */
export function cleanCoords(coords) {
  const lat = Number(coords && coords.lat);
  const lng = Number(coords && coords.lng);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180) || (coords.lat === '' || coords.lng === '')) throw new Error('Coordinates must be a latitude (-90 to 90) and a longitude (-180 to 180)');
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

export function cleanStart(value) {
  if (value === null) return null;
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new Error('startsAt must be a date and time, like 2026-12-05T17:00:00Z');
  return new Date(ms).toISOString();
}

/* ---------- Where a player is ---------- */

// The steps in order: the door, each stage, the final map.
export function steps(hunt) {
  return [
    { id: 'door', title: 'The door', day: 0 },
    ...hunt.stages,
    { id: 'final', ...hunt.final },
  ];
}

export const opensAt = (hunt, step) => (hunt.startsAt ? Date.parse(hunt.startsAt) + step.day * DAY_MS : Infinity);
export const isOn = (hunt, now) => Boolean(hunt && hunt.live && hunt.startsAt && now >= Date.parse(hunt.startsAt));

/**
 * Each step as this player sees it: `open` (its day has come), `ready` (the one before it is solved),
 * `solved`. A step's page only shows when it's open and ready (or always, in an admin's preview).
 */
export function stepStates(hunt, solved, now, preview = false) {
  const done = new Set(solved || []);
  let before = true;
  return steps(hunt).map((step) => {
    const open = preview || (isOn(hunt, now) && now >= opensAt(hunt, step));
    const state = { step, open, ready: before || preview, solved: done.has(step.id) };
    before = state.solved;
    return state;
  });
}

const hintsOut = (hunt, step, now, preview) => (step.hints || [])
  .filter((hint) => preview || now >= opensAt(hunt, step) + hint.day * DAY_MS)
  .map((hint) => hint.text);

/**
 * What the Hayloft page gets for this player: every step they can see (with its page), and when the next one opens.
 * Answers and coordinates are never in it.
 */
export function viewFor(hunt, progress, now, { preview = false } = {}) {
  const states = stepStates(hunt, progress && progress.solved, now, preview);
  const out = [];
  let next = null;
  for (const { step, open, ready, solved } of states) {
    if (!ready) break;
    if (!open) {
      next = { opensAt: new Date(opensAt(hunt, step)).toISOString() };
      break;
    }
    if (step.id === 'door') {
      out.push({ id: 'door', solved, title: 'The door' });
      if (!solved && !preview) break;
      continue;
    }
    const view = { id: step.id, title: step.title, body: step.body, hints: hintsOut(hunt, step, now, preview), solved };
    if (step.radio) view.radio = true;
    if (step.id === 'final') {
      view.map = mapOf(hunt);
      view.radius = hunt.final.radius;
      if (solved) view.note = hunt.final.note;
    }
    out.push(view);
    if (!solved && !preview) break;
  }
  const all = states.every((s) => s.solved);
  return { title: hunt.title, steps: out, next, found: Boolean(progress && progress.found), done: all };
}

/** Which step this player can answer right now (open, ready and not solved), or null. */
export function current(hunt, progress, now) {
  const state = stepStates(hunt, progress && progress.solved, now).find((s) => s.open && s.ready && !s.solved);
  return state ? state.step : null;
}

/* ---------- Trusty TV's intermissions ---------- */

// A number from 0 to 1 from the hunt's seed and some text: the same everywhere, unguessable without the seed.
function roll(seed, text, part = 0) {
  return createHash('sha256').update(`${seed}:${text}`).digest().readUInt32BE(part * 4) / 2 ** 32;
}

/**
 * The intermission on `channel` during `minute` (minutes since 1970, UTC), if there is one: { at (ms), ms, card }.
 * Each minute on each channel has a 1 in `every` chance, decided by the seed, so nobody can work out when the next
 * one is. A channel can have more than one card; each airing shows one of them.
 */
export function intermission(hunt, channel, minute, now) {
  if (!hunt || !isOn(hunt, now)) return null;
  if (minute * 60000 < Date.parse(hunt.startsAt)) return null;
  const cards = hunt.signal.cards.filter((card) => card.channel === channel);
  if (!cards.length) return null;
  const key = `${channel}:${minute}`;
  if (roll(hunt.seed, key, 0) >= 1 / hunt.signal.every) return null;
  const second = Math.floor(roll(hunt.seed, key, 1) * 56) + 2;
  const card = cards[Math.floor(roll(hunt.seed, key, 2) * cards.length)];
  return { at: minute * 60000 + second * 1000, ms: hunt.signal.ms, card: { text: card.text, ...(card.mark ? { mark: card.mark } : {}) } };
}

/** The hints for the intermissions so far (shown on Trusty TV), counted from the launch. */
export const signalHints = (hunt, now) => (isOn(hunt, now)
  ? hunt.signal.hints.filter((hint) => now >= Date.parse(hunt.startsAt) + hint.day * DAY_MS).map((hint) => hint.text)
  : []);

/* ---------- Trusty Radio's dead air ---------- */

// How far off the frequency a broadcast can still be heard (MHz), fading into the static.
export const RADIO_REACH = 0.3;

/** The broadcast at `mhz` for a stage with a radio, as { lines, rate, strength }, or null if it's just static. */
export function broadcastAt(stage, mhz) {
  if (!stage || !stage.radio || typeof mhz !== 'number') return null;
  const off = Math.abs(mhz - stage.radio.mhz);
  if (off > RADIO_REACH + 1e-9) return null;
  return { lines: stage.radio.lines, rate: stage.radio.rate, strength: Math.round((1 - off / (RADIO_REACH + 0.1)) * 100) / 100 };
}

/* ---------- The map ---------- */

const SUITS = ['♠', '♥', '♦', '♣'];
const valueOf = (ch) => (/[0-9]/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 64); // A=1 ... Z=26

/** The digits of the coordinates: 5 decimal places, 2 whole digits for latitude and 3 for longitude. */
export function coordDigits({ lat, lng }) {
  const part = (v, width) => {
    const [whole, frac] = Math.abs(v).toFixed(5).split('.');
    return { whole: whole.padStart(width, '0'), frac };
  };
  return {
    lat: { hemi: lat < 0 ? 'S' : 'N', ...part(lat, 2) },
    lng: { hemi: lng < 0 ? 'W' : 'E', ...part(lng, 3) },
  };
}

/**
 * The coordinates dealt as playing cards. Every digit has the next letter of the key added to it (A is 1, Z is 26,
 * and only the last digit counts), the latitude's digits first, then the longitude's. A card shows that digit,
 * with A for 1 and 10 for 0. Suits mean nothing (they come from the seed). Null until the coordinates are in.
 */
export function mapOf(hunt) {
  if (!hunt.coords) return null;
  const { lat, lng } = coordDigits(hunt.coords);
  let k = 0;
  const deal = (digits, line) => [...digits].map((d, i) => {
    const shifted = (Number(d) + valueOf(hunt.key[k++ % hunt.key.length])) % 10;
    const suit = SUITS[Math.floor(roll(hunt.seed, `suit:${line}:${i}`) * 4)];
    return { rank: shifted === 0 ? '10' : shifted === 1 ? 'A' : String(shifted), suit };
  });
  const row = (part, line) => ({ hemi: part.hemi, whole: deal(part.whole, `${line}w`), frac: deal(part.frac, `${line}f`) });
  return [row(lat, 'lat'), row(lng, 'lng')];
}

/** Takes the key back off the map's cards: what a solver does. For the tests and the admin panel's check. */
export function readMap(map, key) {
  let k = 0;
  const undeal = (cards) => cards.map(({ rank }) => {
    const shown = rank === '10' ? 0 : rank === 'A' ? 1 : Number(rank);
    return String((shown - (valueOf(key[k++ % key.length]) % 10) + 10) % 10);
  }).join('');
  const [lat, lng] = map.map((row) => `${row.hemi === 'S' || row.hemi === 'W' ? '-' : ''}${undeal(row.whole)}.${undeal(row.frac)}`);
  return { lat: Number(lat), lng: Number(lng) };
}

/** Meters between two points on the globe (haversine). */
export function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* ---------- The box's codes ---------- */

// No 0/O, 1/I/L, 2/Z, 5/S, 6/G, 8/B: easy to read off a damp card with a phone torch.
const CODE_LETTERS = 'ACDEFHJKMNPRTUVWXY3479';

/** A new code for a card in the box, like TRVX-7KAE-PM3D (about 53 bits, so nobody can guess one). */
export function newCode() {
  let out = '';
  for (let i = 0; i < 12; i++) out += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

export const codeHash = (salt, code) => hashOf(`code:${salt}`, code);
