// Draw Trusty grader (version 2). Plain JavaScript with no DOM access, so the game page and
// api/draw-api.js grade the same pixels the same way.
//
// Scoring model:
//   coverage   – how much of Trusty's outline has ink near it, scored part by part (head, eyes,
//                mouth, neck, back, legs) so skipping a feature always costs points.
//   precision  – how much of the ink sits on Trusty's lines; credit fades smoothly with distance.
//   ink        – total ink compared with a clean tracing. Painting, scribbling or re-drawing him
//                several times piles up ink, and the score collapses.
//   placement  – the drawing is aligned to Trusty first (a small shift or size change), with a
//                small penalty, so a good drawing that's slightly off isn't wrecked.
//   score = coverage × √precision × inkFactor × placement
import { TRUSTY, DRAW_SIZE, BRUSH_WIDTH } from './draw-reference.js';

export const GRADER_VERSION = 2;

const N = DRAW_SIZE;
const FAR = 1e9;
const INF = 1e20;
const PARTS = ['head', 'eyes', 'mouth', 'neck', 'back', 'legs'];
const PART_WEIGHT = { head: 0.22, eyes: 0.13, mouth: 0.13, neck: 0.08, back: 0.14, legs: 0.3 };
const SAMPLE_STEP = 2;
const INK_ALPHA = 64;
const MIN_INK = 60;
const COVER_FULL = 5;
const COVER_ZERO = 14;
const INK_FULL = 5;
const INK_ZERO = 18;
const INK_ALLOWANCE = 1.6;
const SCALES = [0.9, 0.95, 1, 1.05, 1.1];
const SHIFT = 24;
const SHIFT_STEP = 4;

/* ---------- Euclidean distance transform (Felzenszwalb & Huttenlocher) ---------- */

function edt1d(f, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < N; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < N; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// Distance (in px) from every pixel to the nearest set pixel of `mask`.
function distanceField(mask) {
  const f = new Float64Array(N);
  const d = new Float64Array(N);
  const v = new Int32Array(N);
  const z = new Float64Array(N + 1);
  const grid = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) grid[i] = mask[i] ? 0 : INF;
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) f[y] = grid[y * N + x];
    edt1d(f, d, v, z);
    for (let y = 0; y < N; y++) grid[y * N + x] = d[y];
  }
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) f[x] = grid[y * N + x];
    edt1d(f, d, v, z);
    for (let x = 0; x < N; x++) out[y * N + x] = Math.sqrt(d[x]);
  }
  return out;
}

/* ---------- Reference outline ---------- */

// Calls emit(x, y) at points `step` px apart along a shape; returns the shape's length.
function walk(shape, step, emit) {
  if (shape.type === 'line') {
    const len = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i <= n; i++) emit(shape.x1 + (shape.x2 - shape.x1) * (i / n), shape.y1 + (shape.y2 - shape.y1) * (i / n));
    return len;
  }
  const dt = 0.002;
  let length = 0;
  let next = 0;
  let px = shape.cx + shape.rx * Math.cos(shape.start);
  let py = shape.cy + shape.ry * Math.sin(shape.start);
  emit(px, py);
  for (let t = shape.start + dt; t <= shape.end + 1e-9; t += dt) {
    const x = shape.cx + shape.rx * Math.cos(t);
    const y = shape.cy + shape.ry * Math.sin(t);
    length += Math.hypot(x - px, y - py);
    if (length - next >= step) {
      emit(x, y);
      next = length;
    }
    px = x;
    py = y;
  }
  return length;
}

let reference = null;

function prepareReference() {
  if (reference) return reference;
  const mask = new Uint8Array(N * N);
  const xs = [];
  const ys = [];
  const parts = [];
  let length = 0;
  for (const shape of TRUSTY) {
    const part = PARTS.indexOf(shape.part);
    walk(shape, 0.5, (x, y) => {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix >= 0 && iy >= 0 && ix < N && iy < N) mask[iy * N + ix] = 1;
    });
    length += walk(shape, SAMPLE_STEP, (x, y) => { xs.push(x); ys.push(y); parts.push(part); });
  }
  const partCount = PARTS.map((_, k) => parts.filter((p) => p === k).length);
  reference = {
    distance: distanceField(mask),
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    parts: Uint8Array.from(parts),
    partCount,
    length,
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  return reference;
}

// Build the reference ahead of time (e.g. while the player memorizes) so grading is instant.
export function warmUpGrader() {
  prepareReference();
}

/* ---------- Grading ---------- */

const credit = (d, full, zero) => (d <= full ? 1 : d >= zero ? 0 : 1 - (d - full) / (zero - full));

const placementFactor = (scale, dx, dy) => Math.max(0.85, 1 - 0.0035 * Math.hypot(dx, dy) - 0.8 * Math.abs(scale - 1));

// Scores the drawing against Trusty moved by (dx, dy) and scaled by `scale` around his center.
function measure(ref, inkDistance, inkX, inkY, scale, dx, dy, stride) {
  const { xs, ys, parts, cx, cy } = ref;
  const hits = new Float64Array(PARTS.length);
  for (let i = 0; i < xs.length; i++) {
    const ix = Math.round(cx + scale * (xs[i] - cx) + dx);
    const iy = Math.round(cy + scale * (ys[i] - cy) + dy);
    const d = (ix < 0 || iy < 0 || ix >= N || iy >= N) ? FAR : inkDistance[iy * N + ix];
    hits[parts[i]] += credit(d, COVER_FULL, COVER_ZERO);
  }
  let coverage = 0;
  const partCoverage = {};
  PARTS.forEach((name, k) => {
    partCoverage[name] = hits[k] / ref.partCount[k];
    coverage += PART_WEIGHT[name] * partCoverage[name];
  });

  let sum = 0;
  let count = 0;
  for (let i = 0; i < inkX.length; i += stride) {
    const ix = Math.round(cx + (inkX[i] - dx - cx) / scale);
    const iy = Math.round(cy + (inkY[i] - dy - cy) / scale);
    const d = (ix < 0 || iy < 0 || ix >= N || iy >= N) ? FAR : ref.distance[iy * N + ix] * scale;
    sum += credit(d, INK_FULL, INK_ZERO);
    count++;
  }
  return { coverage, precision: count ? sum / count : 0, partCoverage };
}

/**
 * Grades a 500x500 drawing. `rgba` is RGBA pixel data (canvas getImageData().data, or a decoded PNG);
 * only the alpha channel is used. Returns the 0–100 score plus the pieces it was built from.
 */
export function gradeDrawing(rgba) {
  if (!rgba || rgba.length !== N * N * 4) throw new Error('Drawing must be 500x500 RGBA pixels');
  const ref = prepareReference();

  const ink = new Uint8Array(N * N);
  let inkCount = 0;
  for (let i = 0; i < N * N; i++) {
    if (rgba[i * 4 + 3] > INK_ALPHA) {
      ink[i] = 1;
      inkCount++;
    }
  }
  if (inkCount < MIN_INK) {
    return { version: GRADER_VERSION, score: 0, empty: true, coverage: 0, precision: 0, inkRatio: 0, inkFactor: 1, placement: 1, offset: { dx: 0, dy: 0, scale: 1 }, parts: Object.fromEntries(PARTS.map((p) => [p, 0])), weakestPart: null };
  }

  const inkX = new Int16Array(inkCount);
  const inkY = new Int16Array(inkCount);
  for (let i = 0, k = 0; i < N * N; i++) {
    if (ink[i]) {
      inkX[k] = i % N;
      inkY[k] = (i / N) | 0;
      k++;
    }
  }
  const inkDistance = distanceField(ink);

  // Coarse-to-fine search for the placement that best explains the drawing. The search samples a
  // bounded number of ink pixels so heavy scribbling can't make grading slow; the final score uses all of them.
  const coarseStride = Math.max(3, Math.ceil(inkCount / 2500));
  const fineStride = Math.max(1, Math.ceil(inkCount / 12000));
  let best = null;
  const consider = (scale, dx, dy, stride) => {
    const m = measure(ref, inkDistance, inkX, inkY, scale, dx, dy, stride);
    const fit = m.coverage * Math.sqrt(m.precision) * placementFactor(scale, dx, dy);
    if (!best || fit > best.fit) best = { scale, dx, dy, fit };
  };
  for (const scale of SCALES) {
    for (let dx = -SHIFT; dx <= SHIFT; dx += SHIFT_STEP) {
      for (let dy = -SHIFT; dy <= SHIFT; dy += SHIFT_STEP) consider(scale, dx, dy, coarseStride);
    }
  }
  const coarse = best;
  best = null;
  for (const scale of [coarse.scale - 0.025, coarse.scale, coarse.scale + 0.025]) {
    for (let dx = coarse.dx - 3; dx <= coarse.dx + 3; dx++) {
      for (let dy = coarse.dy - 3; dy <= coarse.dy + 3; dy++) consider(scale, dx, dy, fineStride);
    }
  }

  const { coverage, precision, partCoverage } = measure(ref, inkDistance, inkX, inkY, best.scale, best.dx, best.dy, 1);
  const inkRatio = inkCount / (ref.length * BRUSH_WIDTH * best.scale);
  const inkFactor = inkRatio <= INK_ALLOWANCE ? 1 : Math.pow(INK_ALLOWANCE / inkRatio, 1.5);
  const placement = placementFactor(best.scale, best.dx, best.dy);
  const raw = coverage * Math.sqrt(precision) * inkFactor * placement;
  const score = Math.max(0, Math.min(100, Math.floor(raw * 100 + 1e-6)));

  let weakestPart = null;
  for (const name of PARTS) {
    if (partCoverage[name] < 0.6 && (!weakestPart || partCoverage[name] < partCoverage[weakestPart])) weakestPart = name;
  }

  return {
    version: GRADER_VERSION,
    score,
    empty: false,
    coverage,
    precision,
    inkRatio,
    inkFactor,
    placement,
    offset: { dx: best.dx, dy: best.dy, scale: best.scale },
    parts: partCoverage,
    weakestPart,
  };
}
