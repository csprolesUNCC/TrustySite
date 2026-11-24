// Share cards: a square picture of a result on a page of Trusty's notebook (a Trustle game, a big win on the
// Slots, a profile), drawn on a canvas, with a dialog to share it (the Web Share API, with the picture as a file),
// save it or copy it. Used by pages/games/trustle.html, pages/games/slots.html and pages/profile.html.
//
//   openShareCard({ eyebrow, title, big, bigColor, sub, lines, grid, by, filename, text })
//     grid: rows of 'correct' | 'present' | 'absent' (a Trustle game: colors only, never the letters).
//     by: whose card it is, under the title. text: what goes with the picture when it's shared (a link, say).
import { h, toast } from './site.js';

const SIZE = 1080;
const MARGIN_X = 128;
const RIGHT = SIZE - 72;
const INK = {
  paper: '#fbf8f0', ink: '#1b1b1f', pencil: '#5a5d63', rule: '#c9d9ec', margin: '#ee9aa4', blue: '#1f4fbf',
  green: '#23824a', highlight: '#ffe45c', absent: '#d5d8dd', absentLine: '#aeb2b9',
};
const MARKER = '"Permanent Marker", "Marker Felt", "Comic Sans MS", cursive';
const HAND = 'Caveat, "Segoe Print", "Bradley Hand", cursive';
const BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Line art drawn on (not quite) white, as ink only: light pixels go clear and dark ones keep their darkness as
// opacity, so the drawing sits on the ruled paper like it was drawn there.
function inked(img, width) {
  const height = Math.round((img.naturalHeight / img.naturalWidth) * width);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, width, height);
  const data = x.getImageData(0, 0, width, height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const ink = Math.max(0, Math.min(1, (215 - lum) / 150));
    px[i + 3] = Math.round(px[i + 3] * ink);
    px[i] = px[i + 1] = px[i + 2] = 27;
  }
  x.putImageData(data, 0, 0);
  return c;
}

// The biggest font size up to `size` at which `text` fits in `width`.
function fit(ctx, text, family, size, width, weight = '') {
  let px = size;
  do {
    ctx.font = `${weight} ${px}px ${family}`.trim();
    if (ctx.measureText(text).width <= width) break;
    px -= 4;
  } while (px > 16);
  return px;
}

function paper(ctx) {
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = INK.rule;
  ctx.lineWidth = 2;
  for (let y = 190; y < SIZE - 20; y += 54) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
  }
  ctx.strokeStyle = INK.margin;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X - 24, 0);
  ctx.lineTo(MARGIN_X - 24, SIZE);
  ctx.stroke();
  // Three punched holes down the left edge, like a ring binder's page.
  ctx.fillStyle = '#e9e3d4';
  for (const y of [SIZE * 0.2, SIZE * 0.5, SIZE * 0.8]) {
    ctx.beginPath();
    ctx.arc(46, y, 20, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Colored squares for a Trustle game, as big as fit in the box.
function drawGrid(ctx, grid, top, bottom) {
  const cols = Math.max(...grid.map((row) => row.length));
  const gap = 14;
  const width = RIGHT - MARGIN_X;
  const cell = Math.min(110, (width - gap * (cols - 1)) / cols, (bottom - top - gap * (grid.length - 1)) / grid.length);
  const left = MARGIN_X + (width - (cell * cols + gap * (cols - 1))) / 2;
  grid.forEach((row, r) => row.forEach((state, c) => {
    const x = left + c * (cell + gap);
    const y = top + r * (cell + gap);
    ctx.fillStyle = state === 'correct' ? INK.green : state === 'present' ? INK.highlight : INK.absent;
    ctx.strokeStyle = state === 'absent' ? INK.absentLine : INK.ink;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, cell, cell, 10);
    ctx.fill();
    ctx.stroke();
  }));
  return top + grid.length * (cell + gap) - gap;
}

/** Draws the card on a new canvas. */
export async function drawCard({ eyebrow = '', title, big = '', bigColor = INK.blue, sub = '', lines = [], grid = null, by = '' }) {
  await Promise.all([`72px ${MARKER}`, `60px ${HAND}`].map((font) => document.fonts.load(font).catch(() => null)));
  const [face, trusty] = await Promise.all([loadImage('/images/icons/mobile-icon-96.webp'), loadImage('/images/trusty/trusty-v2.webp')]);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  paper(ctx);
  const width = RIGHT - MARGIN_X;
  ctx.textBaseline = 'alphabetic';

  // Who made the notebook.
  if (face) ctx.drawImage(inked(face, 84), MARGIN_X, 52);
  ctx.fillStyle = INK.ink;
  ctx.font = `44px ${MARKER}`;
  ctx.fillText('Trusty da Horse', MARGIN_X + (face ? 104 : 0), 112);

  let y = 260;
  if (eyebrow) {
    ctx.fillStyle = INK.pencil;
    fit(ctx, eyebrow, HAND, 56, width, '700');
    ctx.fillText(eyebrow, MARGIN_X, y);
    y += 92;
  }
  ctx.fillStyle = INK.ink;
  fit(ctx, title, MARKER, 92, width);
  ctx.fillText(title, MARGIN_X, y);
  y += 28;
  if (by) {
    y += 52;
    ctx.fillStyle = INK.pencil;
    fit(ctx, by, HAND, 56, width, '700');
    ctx.fillText(by, MARGIN_X, y);
  }

  if (grid && grid.length) {
    y = drawGrid(ctx, grid, y + 44, 860) + 20;
  } else {
    if (big) {
      y += 210;
      ctx.fillStyle = bigColor;
      fit(ctx, big, MARKER, 230, width);
      ctx.fillText(big, MARGIN_X, y);
    }
    if (sub) {
      y += 84;
      ctx.fillStyle = INK.ink;
      fit(ctx, sub, HAND, 68, width - 40, '700');
      ctx.fillText(sub, MARGIN_X, y);
    }
    y += 24;
    ctx.fillStyle = INK.ink;
    for (const line of lines.slice(0, 4)) {
      y += 58;
      fit(ctx, line, BODY, 38, width - 280, '600'); // leaves room for Trusty in the corner
      ctx.fillText(line, MARGIN_X, y);
    }
  }

  // Trusty in the corner, and where to find him.
  if (trusty) {
    const art = inked(trusty, grid ? 200 : 260);
    ctx.drawImage(art, SIZE - art.width - 44, SIZE - art.height - 30);
  }
  ctx.fillStyle = INK.pencil;
  ctx.font = `700 50px ${HAND}`;
  ctx.fillText('trustydahorse.com', MARGIN_X, SIZE - 56);
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

let dialog = null;
function theDialog() {
  if (dialog) return dialog;
  const title = h('h2', { id: 'share-card-title' }, 'Share');
  const preview = h('img', { class: 'share-card-preview', alt: '', width: 540, height: 540 });
  const actions = h('div', { class: 'btn-row share-card-actions' });
  const close = h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Close' }, '✕');
  dialog = h('dialog', { class: 'modal share-card-dialog', 'aria-labelledby': 'share-card-title' },
    h('div', { class: 'modal-head' }, title, close),
    h('div', { class: 'modal-body' }, preview, actions));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.removeAttribute('src');
  });
  Object.assign(dialog, { parts: { title, preview, actions } });
  document.body.append(dialog);
  return dialog;
}

/** Draws the card and opens the dialog to share, save or copy it. */
export async function openShareCard(spec) {
  let blob;
  try {
    blob = await toBlob(await drawCard(spec));
  } catch {
    blob = null;
  }
  if (!blob) {
    toast('Couldn’t make the picture. Try again?', 'error');
    return;
  }
  const d = theDialog();
  const { title, preview, actions } = d.parts;
  const filename = spec.filename || 'trusty.png';
  const file = new File([blob], filename, { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  title.textContent = spec.dialogTitle || 'Share your card';
  if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
  preview.src = url;
  preview.alt = [spec.eyebrow, spec.title, spec.big, spec.sub].filter(Boolean).join(', ');

  const buttons = [];
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    buttons.push(h('button', {
      type: 'button',
      class: 'btn',
      onclick: async () => {
        try {
          await navigator.share({ files: [file], text: spec.text || undefined });
          d.close();
        } catch (err) {
          if (!err || err.name !== 'AbortError') toast('Couldn’t share it. Save it instead?', 'error');
        }
      },
    }, 'Share'));
  }
  buttons.push(h('a', { class: buttons.length ? 'btn btn-outline' : 'btn', href: url, download: filename }, 'Save picture'));
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    buttons.push(h('button', {
      type: 'button',
      class: 'btn btn-outline',
      onclick: async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          toast('Copied the picture! Paste it anywhere.', 'success');
        } catch {
          toast('Couldn’t copy it. Your browser said no.', 'error');
        }
      },
    }, 'Copy picture'));
  }
  actions.replaceChildren(...buttons);
  if (!d.open) d.showModal();
}
