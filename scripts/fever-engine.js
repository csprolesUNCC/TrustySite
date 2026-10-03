// Trusty Fever's rules and computer players, with no drawing or input code so they can be tested outside
// the browser. It's Curve Fever (Achtung, die Kurve!): every line keeps moving, a player who hits a wall or
// any line is out, and each crash gives everyone still going a point. pages/games/fever.html draws the game
// from the events that update() returns.

export const ARENA_W = 800;
export const ARENA_H = 600;

const CELLS = ARENA_W * ARENA_H;
const SPEED = 1.4;            // px per step; the game runs 60 steps a second
const TURN = 0.052;           // radians per step while steering (about a 27 px turning circle)
const THICK = 5;              // line width
const GAP_EVERY = [140, 330]; // px of line between gaps
const POWER_R = 13;           // power-up radius
const MAX_POWERS = 5;
// Each head feels for lines at five points across its front.
const PROBES = [-1.1, -0.55, 0, 0.55, 1.1];

export const PLAYERS = [
  { name: 'Trusty', color: '#1b1b1f' },
  { name: 'Rusty', color: '#e07014' },
  { name: 'Dusty', color: '#1f5fcf' },
  { name: 'Crusty', color: '#d6334b' },
  { name: 'Gusty', color: '#23824a' },
  { name: 'Musty', color: '#8a3fc4' },
];

// every: steps between decisions; look: steps they plan ahead; slip: chance of a random decision;
// foresee: steps ahead they guess where everyone else is heading (so they don't get cut off).
export const SKILLS = {
  easy: { every: 6, look: 50, slip: 0.08, foresee: 0 },
  normal: { every: 3, look: 90, slip: 0.015, foresee: 35 },
  hard: { every: 2, look: 130, slip: 0, foresee: 60 },
};
const FUTURE_CELL = 4;
const FW = ARENA_W / FUTURE_CELL;
const FH = ARENA_H / FUTURE_CELL;

// group is who a power-up hits: 'self' (whoever grabs it), 'others' (everyone else) or 'all'.
export const POWERS = {
  fast: { group: 'self', effect: 'fast', steps: 300, weight: 1, label: 'Zoom!' },
  slow: { group: 'self', effect: 'slow', steps: 300, weight: 1, label: 'Slow-mo' },
  thin: { group: 'self', effect: 'thin', steps: 420, weight: 1, label: 'Skinny!' },
  ghost: { group: 'self', effect: 'ghost', steps: 240, weight: 0.7, label: 'Ghost!' },
  rush: { group: 'others', effect: 'fast', steps: 300, weight: 1, label: 'Everyone else: zoom!' },
  fat: { group: 'others', effect: 'fat', steps: 360, weight: 1, label: 'Everyone else: chunky!' },
  flip: { group: 'others', effect: 'flip', steps: 300, weight: 0.9, label: 'Everyone else: backwards!' },
  square: { group: 'others', effect: 'square', steps: 300, weight: 0.8, label: 'Everyone else: square turns!' },
  eraser: { group: 'all', effect: null, steps: 0, weight: 0.5, label: 'Eraser!' },
  walls: { group: 'all', effect: null, steps: 480, weight: 0.7, label: 'No walls!' },
};
const POWER_KINDS = Object.keys(POWERS);
const POWER_WEIGHT = POWER_KINDS.reduce((sum, kind) => sum + POWERS[kind].weight, 0);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrapX = (x) => ((x % ARENA_W) + ARENA_W) % ARENA_W;
const wrapY = (y) => ((y % ARENA_H) + ARENA_H) % ARENA_H;

// setup: { humans, bots, skill: 'easy' | 'normal' | 'hard', powerups: boolean, length: points per opponent }.
// Humans are the first players; set player.control.turn (-1, 0 or 1) before each update, and
// player.control.tap (-1 or 1) for a 90° turn while "square turns" is on.
export function createMatch(setup, options = {}) {
  const random = options.random || Math.random;
  const READY = options.readySteps ?? 100;
  const FIRST_READY = options.firstReadySteps ?? 150;
  const END = options.endSteps ?? 150;
  const skill = SKILLS[setup.skill] || SKILLS.normal;
  const rand = (lo, hi) => lo + random() * (hi - lo);

  const owner = new Uint8Array(CELLS);   // who drew each pixel (0 = nobody)
  const stamp = new Float32Array(CELLS); // how far that player had gone when they drew it

  const count = Math.min(PLAYERS.length, setup.humans + setup.bots);
  // Where each player is likely to be over the next few steps: the step they'd get to each 4 px cell.
  const futures = Array.from({ length: count }, () => new Uint8Array(FW * FH));
  let futuresAt = -1;
  const players = PLAYERS.slice(0, count).map((look, i) => ({
    id: i + 1,
    name: look.name,
    color: look.color,
    human: i < setup.humans,
    score: 0,
    control: { turn: 0, tap: 0 },
    alive: false,
    x: 0,
    y: 0,
    a: 0,
    r: THICK / 2,
    effects: [],
  }));

  const match = {
    players,
    target: setup.length * Math.max(1, count - 1),
    round: 0,
    phase: 'idle',  // idle | ready | play | end | over
    timer: 0,       // steps left in the ready or end phase
    steps: 0,       // steps played this round
    powerups: [],
    wrapLeft: 0,    // steps left with the walls open
    winner: null,   // the last round's survivor, if any
    champion: null, // who won the game
    begin,
    update,
    skipWait,
  };
  let nextPower = 0;

  /* ---------- Rounds ---------- */

  function begin() {
    const events = [];
    startRound(events);
    return events;
  }

  function startRound(events) {
    match.round += 1;
    match.phase = 'ready';
    match.timer = match.round === 1 ? FIRST_READY : READY;
    match.steps = 0;
    match.powerups = [];
    match.wrapLeft = 0;
    match.winner = null;
    owner.fill(0);
    nextPower = Math.round(rand(200, 330));
    spawn();
    events.push({ type: 'round', round: match.round });
  }

  // Spread out, away from the walls, heading roughly for the middle.
  function spawn() {
    const spots = [];
    for (const p of players) {
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 80; tries++) {
        x = rand(90, ARENA_W - 90);
        y = rand(90, ARENA_H - 90);
        if (spots.every((s) => (s.x - x) ** 2 + (s.y - y) ** 2 >= 130 ** 2)) break;
      }
      spots.push({ x, y });
      Object.assign(p, {
        x, y, px: x, py: y,
        a: Math.atan2(ARENA_H / 2 - y, ARENA_W / 2 - x) + rand(-1, 1),
        alive: true, crashed: false, traveled: 0,
        gapLeft: 0, nextGap: rand(...GAP_EVERY), inked: false, jumped: false, segs: [],
        effects: [], speed: SPEED, r: THICK / 2, ghost: false, flip: false, square: false,
        wait: 1 + Math.floor(random() * 3), turn: 0, commit: 0, cool: 0,
      });
      p.control.turn = 0;
      p.control.tap = 0;
    }
  }

  function endRound(winner, events) {
    match.phase = 'end';
    match.timer = END;
    match.winner = winner;
    events.push({ type: 'roundEnd', id: winner ? winner.id : 0 });
    // Achtung's rule: reach the target at least 2 points ahead of everyone.
    const ranked = [...players].sort((a, b) => b.score - a.score);
    const lead = ranked[0].score - (ranked[1] ? ranked[1].score : 0);
    if (ranked[0].score >= match.target && lead >= 2) {
      match.phase = 'over';
      match.champion = ranked[0];
      events.push({ type: 'gameOver', id: ranked[0].id });
    }
  }

  function skipWait() {
    if (match.phase === 'end') match.timer = 1;
  }

  // One step (1/60 s). Returns what happened, for drawing.
  function update() {
    const events = [];
    if (match.phase === 'ready') {
      if (--match.timer <= 0) {
        match.phase = 'play';
        events.push({ type: 'go' });
      }
    } else if (match.phase === 'end') {
      if (--match.timer <= 0) startRound(events);
    } else if (match.phase === 'play') {
      play(events);
    }
    return events;
  }

  function play(events) {
    match.steps += 1;
    if (match.wrapLeft > 0) match.wrapLeft -= 1;
    const alive = players.filter((p) => p.alive);
    for (const p of alive) refresh(p);
    spawnPower(events);
    for (const p of alive) steer(p);

    // Heads move in steps of at most 1 px so fast ones can't skip over a line.
    let substeps = 1;
    for (const p of alive) {
      p.sub = Math.max(1, Math.ceil(p.speed));
      p.subLen = p.speed / p.sub;
      p.segs = [];
      substeps = Math.max(substeps, p.sub);
    }
    const crashed = [];
    for (let k = 0; k < substeps; k++) {
      for (const p of alive) if (!p.crashed && k < p.sub) move(p);
      // Everyone moves before anyone checks, so head-on crashes take out both players.
      for (const p of alive) {
        if (!p.crashed && k < p.sub && hits(p)) {
          p.crashed = true;
          crashed.push(p);
        }
      }
      for (const p of alive) if (!p.crashed && k < p.sub) ink(p);
    }
    for (const p of alive) {
      if (p.segs.length) events.push({ type: 'ink', id: p.id, color: p.color, width: p.r * 2, segs: p.segs });
    }

    if (crashed.length) {
      const survivors = alive.filter((p) => !p.crashed);
      for (const p of crashed) {
        p.alive = false;
        events.push({ type: 'crash', id: p.id, x: p.x, y: p.y });
      }
      for (const p of survivors) p.score += crashed.length;
      if (survivors.length) events.push({ type: 'score', ids: survivors.map((p) => p.id), points: crashed.length });
    }

    for (const p of alive) if (p.alive) pickUp(p, events);

    const left = players.filter((p) => p.alive);
    if (players.length > 1 ? left.length <= 1 : left.length === 0) endRound(left[0] || null, events);
  }

  /* ---------- Moving and crashing ---------- */

  function steer(p) {
    const c = p.control;
    if (p.human) {
      const flip = p.flip ? -1 : 1;
      if (p.square) {
        if (c.tap) p.a += c.tap * flip * Math.PI / 2;
      } else {
        p.a += c.turn * flip * TURN;
      }
      c.tap = 0;
    } else {
      botSteer(p);
    }
    if (p.a > Math.PI) p.a -= 2 * Math.PI;
    else if (p.a < -Math.PI) p.a += 2 * Math.PI;
  }

  function move(p) {
    p.px = p.x;
    p.py = p.y;
    p.x += Math.cos(p.a) * p.subLen;
    p.y += Math.sin(p.a) * p.subLen;
    p.traveled += p.subLen;
    p.jumped = false;
    if (match.wrapLeft > 0 && (p.x < 0 || p.x >= ARENA_W || p.y < 0 || p.y >= ARENA_H)) {
      p.x = wrapX(p.x);
      p.y = wrapY(p.y);
      p.jumped = true;
    }
  }

  // A player's own line right behind its head doesn't count (it's still being drawn).
  const fresh = (p, i, traveled) => owner[i] === p.id && traveled - stamp[i] < 2 * p.r + 4;

  function hits(p) {
    const walls = match.wrapLeft <= 0;
    if (walls && (p.x - p.r < 0 || p.x + p.r > ARENA_W || p.y - p.r < 0 || p.y + p.r > ARENA_H)) return true;
    if (p.ghost) return false;
    const reach = p.r + 1.2;
    for (const phi of PROBES) {
      let x = p.x + Math.cos(p.a + phi) * reach;
      let y = p.y + Math.sin(p.a + phi) * reach;
      if (!walls) {
        x = wrapX(x);
        y = wrapY(y);
      } else if (x < 0 || y < 0 || x >= ARENA_W || y >= ARENA_H) {
        continue;
      }
      const i = (y | 0) * ARENA_W + (x | 0);
      if (owner[i] && !fresh(p, i, p.traveled)) return true;
    }
    return false;
  }

  // Draws the head's disc into the grid, and adds the move to the line the page draws.
  function ink(p) {
    if (p.ghost) {
      p.inked = false;
      return;
    }
    if (p.gapLeft > 0) {
      p.gapLeft -= p.subLen;
      p.inked = false;
      return;
    }
    p.nextGap -= p.subLen;
    if (p.nextGap <= 0) {
      p.gapLeft = p.r * 2 * 3.6 + 4;
      p.nextGap = rand(...GAP_EVERY);
    }
    const r2 = p.r * p.r;
    const x0 = Math.max(0, Math.floor(p.x - p.r));
    const x1 = Math.min(ARENA_W - 1, Math.floor(p.x + p.r));
    const y0 = Math.max(0, Math.floor(p.y - p.r));
    const y1 = Math.min(ARENA_H - 1, Math.floor(p.y + p.r));
    for (let cy = y0; cy <= y1; cy++) {
      const dy = cy + 0.5 - p.y;
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx + 0.5 - p.x;
        if (dx * dx + dy * dy > r2) continue;
        const i = cy * ARENA_W + cx;
        owner[i] = p.id;
        stamp[i] = p.traveled;
      }
    }
    if (p.inked && !p.jumped) p.segs.push(p.px, p.py, p.x, p.y);
    else p.segs.push(p.x - 0.01, p.y, p.x, p.y);
    p.inked = true;
  }

  /* ---------- Power-ups ---------- */

  function refresh(p) {
    if (p.effects.length) p.effects = p.effects.filter((e) => e.until > match.steps);
    let fast = 0;
    let slow = 0;
    let thin = 0;
    let fat = 0;
    p.ghost = false;
    p.flip = false;
    p.square = false;
    for (const e of p.effects) {
      if (e.kind === 'fast') fast += 1;
      else if (e.kind === 'slow') slow += 1;
      else if (e.kind === 'thin') thin += 1;
      else if (e.kind === 'fat') fat += 1;
      else p[e.kind] = true;
    }
    p.speed = SPEED * clamp(1.6 ** fast * 0.6 ** slow, 0.45, 3);
    p.r = clamp(THICK * 2 ** fat * 0.5 ** thin, 2.2, 16) / 2;
  }

  function spawnPower(events) {
    if (!setup.powerups || --nextPower > 0) return;
    nextPower = Math.round(rand(150, 360));
    if (match.powerups.length >= MAX_POWERS) return;
    for (let tries = 0; tries < 30; tries++) {
      const x = rand(30, ARENA_W - 30);
      const y = rand(30, ARENA_H - 30);
      if (players.some((p) => p.alive && (p.x - x) ** 2 + (p.y - y) ** 2 < 80 ** 2)) continue;
      if (match.powerups.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < 48 ** 2)) continue;
      if (!clearAround(x, y, POWER_R + 3)) continue;
      let roll = random() * POWER_WEIGHT;
      const kind = POWER_KINDS.find((k) => (roll -= POWERS[k].weight) < 0) || POWER_KINDS[0];
      match.powerups.push({ kind, x, y, born: match.steps });
      events.push({ type: 'power', kind, x, y });
      return;
    }
  }

  function clearAround(x, y, radius) {
    for (let dy = -radius; dy <= radius; dy += 4) {
      for (let dx = -radius; dx <= radius; dx += 4) {
        if (dx * dx + dy * dy > radius * radius) continue;
        if (owner[((y + dy) | 0) * ARENA_W + ((x + dx) | 0)]) return false;
      }
    }
    return true;
  }

  function pickUp(p, events) {
    for (let i = match.powerups.length - 1; i >= 0; i--) {
      const pu = match.powerups[i];
      if ((p.x - pu.x) ** 2 + (p.y - pu.y) ** 2 > (POWER_R + p.r) ** 2) continue;
      match.powerups.splice(i, 1);
      const def = POWERS[pu.kind];
      if (pu.kind === 'eraser') {
        owner.fill(0);
        events.push({ type: 'erase' });
      } else if (pu.kind === 'walls') {
        match.wrapLeft = Math.max(match.wrapLeft, def.steps);
      } else {
        const targets = def.group === 'self' ? [p] : players.filter((o) => o.alive && o !== p);
        for (const t of targets) {
          t.effects.push({ kind: def.effect, until: match.steps + def.steps });
          refresh(t);
        }
      }
      events.push({ type: 'pickup', id: p.id, kind: pu.kind, x: pu.x, y: pu.y });
    }
  }

  /* ---------- Computer players ---------- */

  // They try a handful of moves (turn for a while then straighten, or keep turning), see how long each
  // one survives, and prefer the ones that end up in open space.
  const PLAN_TURNS = [8, 20, 40];

  function botSteer(p) {
    if (p.square) {
      if (p.cool > 0) p.cool -= 1;
      if (--p.wait > 0 || p.cool > 0) return;
      p.wait = skill.every;
      const d = squareTurn(p);
      if (d) {
        p.a += d * Math.PI / 2;
        p.cool = 6;
      }
      return;
    }
    if (--p.wait <= 0) {
      p.wait = skill.every;
      p.turn = planTurn(p);
    }
    p.a += p.turn * TURN;
  }

  function planTurn(p) {
    const look = skill.look;
    const rivals = rivalsOf(p);
    const score = { '-1': -1, 0: simulate(p, p.a, 0, 0, look, rivals), 1: -1 };
    for (const d of [-1, 1]) {
      for (const k of PLAN_TURNS) score[d] = Math.max(score[d], simulate(p, p.a, d, k, look, rivals));
      score[d] = Math.max(score[d], simulate(p, p.a, d, look, look, rivals));
    }
    if (skill.slip && random() < skill.slip) return Math.floor(random() * 3) - 1;
    const best = Math.max(score[-1], score[0], score[1]);
    if (best <= look) {
      // Trouble ahead: take the best way out, keeping the current turn on a tie so it doesn't wobble.
      p.commit = 0;
      return [-1, 0, 1].reduce((pick, d) => (score[d] > score[pick] ? d : pick), p.turn);
    }
    // All clear: wander, sticking with a curve for a while.
    const ok = [-1, 0, 1].filter((d) => score[d] >= best - 4);
    if (p.commit > 0 && ok.includes(p.turn)) {
      p.commit -= 1;
      return p.turn;
    }
    const pool = ok.flatMap((d) => (d === 0 ? [0, 0] : [d]));
    p.commit = Math.floor(rand(8, 24));
    return pool[Math.floor(random() * pool.length)];
  }

  // With square turns, only turn when something's in the way (or very occasionally, for variety).
  function squareTurn(p) {
    const look = skill.look;
    const rivals = rivalsOf(p);
    const straight = simulate(p, p.a, 0, 0, look, rivals);
    if (straight > look && random() > 0.02) return 0;
    const left = simulate(p, p.a - Math.PI / 2, 0, 0, look, rivals);
    const right = simulate(p, p.a + Math.PI / 2, 0, 0, look, rivals);
    if (straight >= Math.max(left, right) - 1) return 0;
    if (left === right) return random() < 0.5 ? -1 : 1;
    return left > right ? -1 : 1;
  }

  function blocked(p, x, y, walls, traveled) {
    if (!walls) {
      x = wrapX(x);
      y = wrapY(y);
    } else if (x < 0 || y < 0 || x >= ARENA_W || y >= ARENA_H) {
      return true;
    }
    const i = (y | 0) * ARENA_W + (x | 0);
    return owner[i] !== 0 && !fresh(p, i, traveled);
  }

  // Marks where each player will be over the next few steps if they keep steering the way they are.
  function buildFutures() {
    if (futuresAt === match.steps) return;
    futuresAt = match.steps;
    for (const o of players) {
      const grid = futures[o.id - 1];
      grid.fill(0);
      if (!o.alive || o.ghost) continue;
      const turn = o.square ? 0 : o.human ? o.control.turn * (o.flip ? -1 : 1) : o.turn;
      const reach = o.r + 4;
      let x = o.x;
      let y = o.y;
      let a = o.a;
      for (let j = 1; j <= skill.foresee; j++) {
        a += turn * TURN;
        x += Math.cos(a) * o.speed;
        y += Math.sin(a) * o.speed;
        if (match.wrapLeft > j) {
          x = wrapX(x);
          y = wrapY(y);
        } else if (x < 0 || y < 0 || x >= ARENA_W || y >= ARENA_H) {
          break;
        }
        const cx0 = Math.max(0, Math.floor((x - reach) / FUTURE_CELL));
        const cx1 = Math.min(FW - 1, Math.floor((x + reach) / FUTURE_CELL));
        const cy0 = Math.max(0, Math.floor((y - reach) / FUTURE_CELL));
        const cy1 = Math.min(FH - 1, Math.floor((y + reach) / FUTURE_CELL));
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            const i = cy * FW + cx;
            if (!grid[i]) grid[i] = j;
          }
        }
      }
    }
  }

  function rivalsOf(p) {
    if (!skill.foresee) return null;
    buildFutures();
    return players.filter((o) => o !== p && o.alive && !o.ghost).map((o) => futures[o.id - 1]);
  }

  // Steps survived turning `d` for `k` steps and then going straight, plus a bonus for open space
  // at the end if it survives the whole way. Other players' likely paths count as lines too, from
  // just before they'd get there.
  function simulate(p, a0, d, k, look, rivals) {
    let x = p.x;
    let y = p.y;
    let a = a0;
    const v = p.speed;
    const r = p.r;
    const reach = r + 1.2;
    const soon = rivals && rivals.length ? skill.foresee + 4 : 0;
    for (let i = 1; i <= look; i++) {
      if (i <= k) a += d * TURN;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      x += ca * v;
      y += sa * v;
      const walls = i > match.wrapLeft;
      if (walls) {
        if (x - r < 0 || x + r > ARENA_W || y - r < 0 || y + r > ARENA_H) return i;
      } else {
        x = wrapX(x);
        y = wrapY(y);
      }
      const traveled = p.traveled + i * v;
      if (blocked(p, x + ca * reach, y + sa * reach, walls, traveled)) return i;
      if (blocked(p, x + Math.cos(a - 0.8) * reach, y + Math.sin(a - 0.8) * reach, walls, traveled)) return i;
      if (blocked(p, x + Math.cos(a + 0.8) * reach, y + Math.sin(a + 0.8) * reach, walls, traveled)) return i;
      if (v > 1.2 && blocked(p, x + ca * (reach - v / 2), y + sa * (reach - v / 2), walls, traveled)) return i;
      if (i <= soon) {
        const cell = Math.floor(y / FUTURE_CELL) * FW + Math.floor(x / FUTURE_CELL);
        for (const grid of rivals) {
          const t = grid[cell];
          if (t && t <= i + 4) return i;
        }
      }
    }
    return look + openness(p, x, y, a, look >= match.wrapLeft);
  }

  function openness(p, x, y, a, walls) {
    let total = 0;
    for (const phi of [-0.9, 0, 0.9]) {
      const ca = Math.cos(a + phi);
      const sa = Math.sin(a + phi);
      let dist = 8;
      while (dist <= 160 && !blocked(p, x + ca * dist, y + sa * dist, walls, Infinity)) dist += 8;
      total += dist;
    }
    return total / 16;
  }

  return match;
}
