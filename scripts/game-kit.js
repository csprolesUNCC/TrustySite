// Shared helpers for the canvas games: sprites, sound with a site-wide mute, focus mode,
// swipe input, crisp canvases, notebook-paper backgrounds and per-device best scores.

const MUTE_KEY = 'trusty:muted';

export const fontsReady = (document.fonts && document.fonts.load)
  ? Promise.all([
    document.fonts.load('40px "Permanent Marker"'),
    document.fonts.load('700 30px "Caveat"'),
  ]).catch(() => {})
  : Promise.resolve();

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Halve repeatedly before the final resize so big line drawings stay crisp when shrunk.
function downscale(source, width, height) {
  let src = source;
  let w = source.naturalWidth || source.width;
  let h = source.naturalHeight || source.height;
  while (w / 2 >= width * 1.4 && h / 2 >= height * 1.4) {
    const step = document.createElement('canvas');
    step.width = Math.round(w / 2);
    step.height = Math.round(h / 2);
    const ctx = step.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, step.width, step.height);
    src = step;
    w = step.width;
    h = step.height;
  }
  return src;
}

// Converts a black-on-white drawing into a transparent sprite so it sits on any background: the lighter a
// pixel, the more see-through it becomes, and anything at or above `threshold` brightness vanishes.
// `clearEdges` blanks that many source pixels at the left and right edges (trusty.png has a stray grey line
// down one side), and `flip` mirrors the drawing.
export function inkSprite(img, { width = img.naturalWidth, height = img.naturalHeight, color = '#1b1b1f', clearEdges = 0, flip = false, threshold = 232 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  if (flip) ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
  ctx.drawImage(downscale(img, canvas.width, canvas.height), 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const [r, g, b] = hexToRgb(color);
  const cut = Math.ceil(clearEdges * canvas.width / img.naturalWidth);
  for (let i = 0; i < px.length; i += 4) {
    const x = (i >> 2) % canvas.width;
    const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    const edge = x < cut || x >= canvas.width - cut;
    const alpha = (lum >= threshold || edge) ? 0 : Math.min(1, (threshold - lum) / (threshold * 0.42));
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = Math.round(alpha * px[i + 3]);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// A canvas whose backing store matches the screen's pixel density, drawn in logical units.
export function setupCanvas(canvas, width, height, maxScale = 2) {
  const scale = Math.min(maxScale, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { ctx, scale };
}

export function offscreen(width, height, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { canvas, ctx };
}

export function drawRuledPaper(ctx, width, height, { line = 32, top = 0, margin = null, paper = '#fdfbf4', rule = '#d3e0f0', marginColor = '#f0a3ac' } = {}) {
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let y = top + line; y < height; y += line) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();
  if (margin != null) {
    ctx.strokeStyle = marginColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margin, 0);
    ctx.lineTo(margin, height);
    ctx.stroke();
  }
}

export function drawGraphPaper(ctx, width, height, { cell, paper = '#ffffff', line = '#dbe6f3', minor = null } = {}) {
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  if (minor) {
    ctx.strokeStyle = minor;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = cell / 2; x < width; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = cell / 2; y < height; y += cell) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width + 0.01; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
  for (let y = 0; y <= height + 0.01; y += cell) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
  ctx.stroke();
}

/* ---------- Sound ---------- */

export const mute = {
  get on() { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } },
  set on(value) { try { localStorage.setItem(MUTE_KEY, value ? '1' : '0'); } catch { /* storage blocked */ } },
};

export function sound(src, { volume = 1 } = {}) {
  const el = new Audio(src);
  el.preload = 'auto';
  el.volume = volume;
  return {
    play() {
      if (mute.on) return;
      try { el.currentTime = 0; } catch { /* not seekable yet */ }
      const playing = el.play();
      if (playing) playing.catch(() => { /* blocked until the user interacts */ });
    },
  };
}

export function bindMuteButton(button) {
  const render = () => button.setAttribute('aria-pressed', String(mute.on));
  button.addEventListener('click', () => { mute.on = !mute.on; render(); });
  render();
}

/* ---------- Layout ---------- */

// Scroll the play area (stage plus any on-screen controls) fully into view when a game starts.
export function bringIntoView(el = document.querySelector('.game-main')) {
  if (!el) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
}

/* ---------- Focus mode ---------- */

// `button` may be null when the page drives focus mode itself via the returned setter.
export function bindFocusMode(stage, button, onChange) {
  const close = stage.querySelector('[data-focus-close]');
  const set = (on) => {
    stage.classList.toggle('is-focus', on);
    document.documentElement.classList.toggle('game-focus', on);
    button?.setAttribute('aria-pressed', String(on));
    if (close) close.hidden = !on;
    onChange?.(on);
  };
  button?.addEventListener('click', () => set(!stage.classList.contains('is-focus')));
  close?.addEventListener('pointerdown', (e) => e.stopPropagation());
  close?.addEventListener('click', (e) => { e.stopPropagation(); set(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stage.classList.contains('is-focus')) set(false);
  });
  return set;
}

/* ---------- Input ---------- */

// Calls handler('left' | 'right' | 'up' | 'down' | 'tap') for touch/pen gestures on `el`.
export function onSwipe(el, handler, { threshold = 26, includeMouse = false } = {}) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    if (!includeMouse && e.pointerType === 'mouse') return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  el.addEventListener('pointerup', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) handler('tap', e);
    else if (Math.abs(dx) > Math.abs(dy)) handler(dx > 0 ? 'right' : 'left', e);
    else handler(dy > 0 ? 'down' : 'up', e);
  });
  el.addEventListener('pointercancel', () => { start = null; });
}

// True when a key press belongs to a form field or modifier shortcut rather than the game.
export function isForeignKey(e) {
  const t = e.target;
  return e.ctrlKey || e.metaKey || e.altKey
    || (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
}

// Space/Enter on a focused button already "clicks" it; games should not also react.
export function isActivationKey(e) {
  return (e.key === ' ' || e.key === 'Enter') && e.target instanceof HTMLElement && !!e.target.closest('button, a');
}

/* ---------- Per-device best scores (for players who aren't logged in) ---------- */

export function localBest(game) {
  try { return Number(localStorage.getItem(`trusty:best:${game}`)) || 0; } catch { return 0; }
}

export function saveLocalBest(game, score) {
  if (score <= localBest(game)) return false;
  try { localStorage.setItem(`trusty:best:${game}`, String(score)); } catch { /* storage blocked */ }
  return true;
}
