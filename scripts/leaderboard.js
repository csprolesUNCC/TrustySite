// Fetch + render the leaderboards. Names and drawings come from other users, so everything
// is built with DOM APIs (never innerHTML) and drawings must be PNG data URLs.
import { h, fmt, session, sessionExpired, loginHref, profileHref } from '/scripts/site.js';
import { referenceCanvas } from '/scripts/draw-reference.js';

const PNG_PREFIX = 'data:image/png;base64,';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function safeDrawing(src) {
  return typeof src === 'string' && src.startsWith(PNG_PREFIX) && BASE64.test(src.slice(PNG_PREFIX.length)) ? src : null;
}

// What the drawing viewer's Report button sends back to api/draw-api.js (?action=report), taken from a
// leaderboard or profile drawing. `reported`: this player has reported it already.
export function reportRef(e) {
  if (!e || typeof e.id !== 'string') return null;
  return { id: e.id, at: typeof e.at === 'string' ? e.at : null, reported: e.reported === true };
}

export const BOARDS = {
  clicks: {
    url: '/api/leaderboard',
    label: 'Top Clickers',
    normalize: (e) => ({ name: e.username, score: e.clicks }),
    format: (n) => fmt(n),
    unit: 'clicks',
  },
  flappy: {
    url: '/api/flappy-api',
    label: 'Flappy Trusty',
    normalize: (e) => ({ name: e.name, score: e.score }),
    format: (n) => fmt(n),
    unit: 'points',
  },
  draw: {
    url: '/api/draw-api?action=get_leaderboard',
    label: 'Draw Trusty',
    normalize: (e) => ({ name: e.name, score: e.score, drawing: safeDrawing(e.drawing), report: reportRef(e) }),
    format: (n) => `${fmt(n)}%`,
    unit: 'accuracy',
  },
  trustis: {
    url: '/api/leaderboard?action=trustis',
    label: 'Trustis',
    normalize: (e) => ({ name: e.name, score: e.score }),
    format: (n) => fmt(n),
    unit: 'points',
  },
};

export async function fetchBoard(key) {
  const board = BOARDS[key];
  const res = await fetch(board.url);
  if (!res.ok) throw new Error(`Leaderboard request failed (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Unexpected leaderboard response');
  return data.map((raw) => {
    const entry = board.normalize(raw || {});
    const named = typeof entry.name === 'string' && entry.name.trim() !== '';
    return {
      ...entry,
      name: named ? entry.name : 'Anonymous',
      profile: named ? profileHref(entry.name) : null,
      score: Number(entry.score) || 0,
    };
  });
}

const isMe = (entry) => session.loggedIn && session.username && entry.name === session.username;

// A name links to that player's profile page.
function nameTag(entry, className) {
  return entry.profile
    ? h('a', { class: className, href: entry.profile, title: `${entry.name}'s profile` }, entry.name)
    : h('span', { class: className, title: entry.name }, entry.name);
}

function drawingThumb(entry, className) {
  if (!entry.drawing) return h('span', { class: `${className} board-thumb-empty`, 'aria-hidden': 'true' });
  return h('button', {
    type: 'button',
    class: className,
    'aria-label': `View ${entry.name}'s drawing`,
    onclick: () => openDrawing(entry),
  }, h('img', { src: entry.drawing, alt: '', loading: 'lazy' }));
}

export function renderList(list, entries, { key, startRank = 1 }) {
  const board = BOARDS[key];
  list.replaceChildren(...entries.map((entry, i) => {
    const rank = startRank + i;
    return h('li', {
      class: `board-row${key === 'draw' ? ' has-thumb' : ''}${isMe(entry) ? ' is-me' : ''}`,
      dataset: { rank },
    },
    h('span', { class: 'board-rank' }, rank),
    key === 'draw' ? drawingThumb(entry, 'board-thumb') : null,
    nameTag(entry, 'board-name'),
    h('span', { class: 'board-score' }, board.format(entry.score)));
  }));
}

export function renderPodium(container, entries, { key }) {
  const board = BOARDS[key];
  if (!entries.length) {
    container.replaceChildren(h('p', { class: 'podium-empty' }, 'No scores yet. Be the first!'));
    return;
  }
  container.replaceChildren(h('ol', { class: 'podium', 'aria-label': `${board.label} top three` },
    entries.slice(0, 3).map((entry, i) => h('li', { class: `podium-spot place-${i + 1}${isMe(entry) ? ' is-me' : ''}` },
      key === 'draw' ? drawingThumb(entry, 'podium-thumb') : null,
      nameTag(entry, 'podium-name'),
      h('span', { class: 'podium-score' }, board.format(entry.score)),
      h('span', { class: 'podium-block', 'aria-label': `Rank ${i + 1}` }, i + 1)))));
}

export function renderStatus(list, message, tone) {
  list.replaceChildren(h('li', { class: tone === 'error' ? 'board-error' : 'board-empty' }, message));
}

export function renderSkeleton(list, rows = 6) {
  list.replaceChildren(...Array.from({ length: rows }, () => h('li', { class: 'skeleton-row', 'aria-hidden': 'true' })));
}

/* ---------- Drawing viewer ---------- */

let viewer;
let overlaySrc;

function fileSafe(text) {
  return String(text).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'artist';
}

// Logged-in players can report someone else's drawing to the admins (pages/admin.html), once each.
// Entries without `report` (the admin page's own) get no Report button.
function resetReport(entry) {
  const { report, ask, status } = viewer;
  report.hidden = !(entry.report && session.loggedIn && entry.name !== session.username);
  report.disabled = Boolean(entry.report && entry.report.reported);
  report.textContent = report.disabled ? 'Reported' : 'Report';
  ask.hidden = true;
  status.replaceChildren();
}

async function sendReport(entry) {
  const { dialog, report, reportYes, status } = viewer;
  reportYes.disabled = true;
  let message;
  let tone = 'error';
  let done = true; // false leaves the question up, to try again
  try {
    const res = await fetch('/api/draw-api?action=report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.report.id, at: entry.report.at }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      entry.report.reported = true;
      tone = 'success';
      message = data.already ? 'You already reported this one. The admins will take a look.' : 'Thanks for telling us! The admins will take a look.';
    } else if (res.status === 401) {
      sessionExpired();
      message = ['Your login expired. ', h('a', { href: loginHref() }, 'Log in again'), ' to report it.'];
    } else {
      message = data.error || 'Couldn’t send the report. Try again?';
      done = res.status === 400 || res.status === 404;
    }
  } catch {
    message = 'Couldn’t reach the server. Check your connection and try again.';
    done = false;
  }
  reportYes.disabled = false;
  if (viewer.entry !== entry || !dialog.open) return;
  if (done) {
    resetReport(entry);
    if (!entry.report.reported) report.hidden = true;
  }
  status.dataset.tone = tone;
  status.replaceChildren(...[message].flat());
}

export function openDrawing(entry) {
  if (!entry.drawing) return;
  overlaySrc ||= referenceCanvas(6).toDataURL('image/png');

  if (!viewer) {
    const title = h('h2', { id: 'drawing-title' });
    const art = h('img', { alt: '' });
    const overlay = h('img', { class: 'drawing-overlay', src: overlaySrc, alt: '', hidden: true });
    const toggle = h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'aria-pressed': 'false' }, 'Show the real Trusty');
    const download = h('a', { class: 'btn btn-sm', download: 'trusty-drawing.png' }, 'Download PNG');
    const report = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Report');
    const reportYes = h('button', { type: 'button', class: 'btn btn-sm' }, 'Report it');
    const reportNo = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Never mind');
    const ask = h('div', { class: 'drawing-ask', hidden: true },
      h('p', null, 'Report this drawing to the admins? You can report a drawing once.'),
      h('div', { class: 'btn-row' }, reportYes, reportNo));
    const status = h('p', { class: 'form-status drawing-status', role: 'status' });
    const close = h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Close' }, '✕');
    const dialog = h('dialog', { class: 'modal', 'aria-labelledby': 'drawing-title' },
      h('div', { class: 'modal-head' }, title, close),
      h('div', { class: 'modal-body' },
        h('div', { class: 'drawing-frame' }, art, overlay),
        h('div', { class: 'drawing-actions' }, toggle, download, report),
        ask,
        status));

    toggle.addEventListener('click', () => {
      overlay.hidden = !overlay.hidden;
      toggle.setAttribute('aria-pressed', String(!overlay.hidden));
      toggle.textContent = overlay.hidden ? 'Show the real Trusty' : 'Hide the real Trusty';
    });
    report.addEventListener('click', () => {
      report.hidden = true;
      ask.hidden = false;
      status.replaceChildren();
      reportYes.focus();
    });
    reportNo.addEventListener('click', () => {
      ask.hidden = true;
      report.hidden = false;
      report.focus();
    });
    reportYes.addEventListener('click', () => sendReport(viewer.entry));
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    viewer = { dialog, title, art, overlay, toggle, download, report, reportYes, ask, status };
  }

  viewer.entry = entry;
  resetReport(entry);
  const board = BOARDS.draw;
  viewer.title.textContent = `${entry.name}'s masterpiece (${board.format(entry.score)})`;
  viewer.art.src = entry.drawing;
  viewer.art.alt = `${entry.name}'s drawing of Trusty`;
  viewer.overlay.hidden = true;
  viewer.toggle.setAttribute('aria-pressed', 'false');
  viewer.toggle.textContent = 'Show the real Trusty';
  viewer.download.href = entry.drawing;
  viewer.download.download = `${fileSafe(entry.name)}_Trusty_${entry.score}pct.png`;
  viewer.dialog.showModal();
}
