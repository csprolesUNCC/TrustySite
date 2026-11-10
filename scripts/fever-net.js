// Trusty Fever online: what the room server (realtime/room.js) tells everyone about each step of a match, and
// how pages/games/fever.html rebuilds the match from it. Pure JS with no DOM, so the server, the page and the
// tests share it.
//
// The server runs the real match (scripts/fever-engine.js). After every update() it sends a step holding only
// what changed: the heads' positions, each new piece of line, the engine's other events, and players' status
// when it changes. Positions and widths travel in tenths of a pixel. The page keeps a "mirror" with the fields
// fever.html draws from (players, powerups, phase, round, wrapLeft...) and gets the engine's own events back
// from each step, so the drawing code works the same for local and online games.

// Bump this whenever a step, a snapshot or a room message (realtime/room.js) changes shape: a page and a room
// server that don't match then refuse each other with "reload", instead of drawing nonsense. The deployed room
// server has its own copy of this file, so redeploy it too (see realtime/worker.js).
export const PROTOCOL = 1;

// Rooms go by four letters with no vowels (so codes can't spell words) and nothing that looks like a number.
export const CODE_LETTERS = 'BCDFGHJKMNPQRSTVWXZ';
export const ROOM_CODE = /^[BCDFGHJKMNPQRSTVWXZ]{4}$/;

const POS = 10;      // positions and line widths: tenths of a pixel
const ANGLE = 1000;  // angles: thousandths of a radian
const ALIVE = 1;
const GHOST = 2;
const FLIP = 4;
const SQUARE = 8;

const q = (v) => Math.round(v * POS);
const tenth = (v) => Math.round(v * POS) / POS;
const flagsOf = (p) => (p.alive ? ALIVE : 0) | (p.ghost ? GHOST : 0) | (p.flip ? FLIP : 0) | (p.square ? SQUARE : 0);

// Everything that can change during a match apart from the lines, as plain numbers.
//   m: phase and round; w: steps left with the walls open; s: each player's flags, line width and score;
//   h: each head's position; a: which way everyone faces (only drawn before "go").
function view(match, angles) {
  const ps = match.players;
  return {
    m: [match.phase, match.round],
    w: match.wrapLeft,
    s: ps.flatMap((p) => [flagsOf(p), q(p.r * 2), p.score]),
    h: ps.flatMap((p) => [q(p.x), q(p.y)]),
    a: (angles || match.phase === 'ready') ? ps.map((p) => Math.round(p.a * ANGLE)) : 0,
  };
}
const KEYS = ['m', 'w', 's', 'h', 'a'];

// One engine ink event as runs of line: [id, width, x0, y0, x1, y1] each, flat. The pieces a head drew in one
// step are all in a straight line, so the ones that join up become a single run.
function pushRuns(out, e) {
  const s = e.segs;
  const width = q(e.width);
  let [x0, y0, x1, y1] = s;
  const flush = () => {
    let a = q(x0);
    const b = q(y0);
    const c = q(x1);
    const d = q(y1);
    if (a === c && b === d) a -= 1; // keep a dot a dot: browsers may skip a line with no length
    out.push(e.id, width, a, b, c, d);
  };
  for (let i = 4; i < s.length; i += 4) {
    if (s[i] === x1 && s[i + 1] === y1) {
      x1 = s[i + 2];
      y1 = s[i + 3];
    } else {
      flush();
      [x0, y0, x1, y1] = [s[i], s[i + 1], s[i + 2], s[i + 3]];
    }
  }
  flush();
}

// The engine's other events, with positions rounded the way everything else is.
function tidy(e) {
  return 'x' in e ? { ...e, x: tenth(e.x), y: tenth(e.y) } : e;
}

/* ---------- Server side ---------- */

// Made right after match.begin(). step(events) turns what one update() did into a step to send (null when
// nothing changed); snapshot() is the whole match so far, for whoever is joining it.
export function createEncoder(match) {
  const sent = {};
  const first = view(match);
  for (const key of KEYS) sent[key] = JSON.stringify(first[key]);
  let ink = []; // every run since the round started or the last eraser

  return {
    step(events) {
      const now = view(match);
      const out = {};
      for (const key of KEYS) {
        const json = JSON.stringify(now[key]);
        if (json !== sent[key]) {
          out[key] = now[key];
          sent[key] = json;
        }
      }
      const runs = [];
      const other = [];
      for (const e of events) {
        if (e.type === 'ink') pushRuns(runs, e);
        else other.push(tidy(e));
      }
      if (runs.length) {
        out.k = runs;
        for (const n of runs) ink.push(n);
      }
      if (other.length) {
        out.e = other;
        // The eraser rubs out everything, this step's lines too (the engine picks power-ups up last).
        if (other.some((e) => e.type === 'erase' || e.type === 'round')) ink = [];
      }
      return Object.keys(out).length ? out : null;
    },

    snapshot() {
      return {
        ...view(match, true),
        target: match.target,
        players: match.players.map((p) => ({ id: p.id, name: p.name, color: p.color, human: p.human })),
        powerups: match.powerups.map((pu) => ({ kind: pu.kind, x: tenth(pu.x), y: tenth(pu.y) })),
        winner: match.winner ? match.winner.id : 0,
        champion: match.champion ? match.champion.id : 0,
        k: ink.slice(),
      };
    },
  };
}

/* ---------- Page side ---------- */

function apply(m, step) {
  if (step.m) [m.phase, m.round] = step.m;
  if ('w' in step) m.wrapLeft = step.w;
  if (step.s) {
    m.players.forEach((p, i) => {
      const flags = step.s[i * 3];
      p.alive = (flags & ALIVE) !== 0;
      p.ghost = (flags & GHOST) !== 0;
      p.flip = (flags & FLIP) !== 0;
      p.square = (flags & SQUARE) !== 0;
      p.r = step.s[i * 3 + 1] / POS / 2;
      p.score = step.s[i * 3 + 2];
    });
  }
  if (step.h) {
    m.players.forEach((p, i) => {
      p.x = step.h[i * 2] / POS;
      p.y = step.h[i * 2 + 1] / POS;
    });
  }
  if (Array.isArray(step.a)) m.players.forEach((p, i) => { p.a = step.a[i] / ANGLE; });
}

// Runs of line as the engine's ink events, for the page's drawInk().
function inkEvents(m, runs = []) {
  const out = [];
  for (let i = 0; i + 5 < runs.length; i += 6) {
    const p = m.players[runs[i] - 1];
    if (!p) continue;
    out.push({
      type: 'ink', id: p.id, color: p.color, width: runs[i + 1] / POS,
      segs: [runs[i + 2] / POS, runs[i + 3] / POS, runs[i + 4] / POS, runs[i + 5] / POS],
    });
  }
  return out;
}

// The match as the page sees it, from a snapshot. `you` is the id of the player this device steers (0 when
// it's only watching). Returns the mirror and the ink drawn so far this round.
export function createMirror(snap, you = 0) {
  const players = snap.players.map((p) => ({
    id: p.id, name: p.name, color: p.color, human: p.human, you: p.id === you,
    score: 0, alive: true, x: 0, y: 0, a: 0, r: 2.5, ghost: false, flip: false, square: false,
  }));
  const m = {
    online: true,
    demo: false,
    you,
    target: snap.target,
    humans: players.filter((p) => p.human).length,
    players,
    powerups: snap.powerups.map((pu) => ({ ...pu })),
    phase: 'ready',
    round: 0,
    wrapLeft: 0,
    winner: null,
    champion: null,
    skipWait() {}, // the server decides when rounds start
  };
  apply(m, snap);
  m.winner = players[snap.winner - 1] || null;
  m.champion = players[snap.champion - 1] || null;
  return { match: m, ink: inkEvents(m, snap.k) };
}

// Brings the mirror up to date with one step and returns that step's events, as the engine's update() would.
export function applyStep(m, step) {
  apply(m, step);
  const events = inkEvents(m, step.k);
  for (const e of step.e || []) {
    if (e.type === 'power') {
      m.powerups.push({ kind: e.kind, x: e.x, y: e.y });
    } else if (e.type === 'pickup') {
      const i = m.powerups.findIndex((pu) => pu.kind === e.kind && pu.x === e.x && pu.y === e.y);
      if (i >= 0) m.powerups.splice(i, 1);
    } else if (e.type === 'round') {
      m.powerups = [];
      m.winner = null;
    } else if (e.type === 'roundEnd') {
      m.winner = m.players[e.id - 1] || null;
    } else if (e.type === 'gameOver') {
      m.champion = m.players[e.id - 1] || null;
    }
    events.push(e);
  }
  return events;
}
