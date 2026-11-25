// The page's side of Golden Trusties (rules in scripts/golden.js, the server's side in utils/golden.js): asks
// GET /api/clicks?action=golden whether one is out, waits as long as the answer says before asking again (only
// while the tab is being looked at), and when one is out shows him somewhere on the screen for a few seconds.
// Catching him sends his token back, and the header clicker counts the bonus. scripts/site.js loads this for
// logged-in players on every page but the games (a pop-up mid-game would cost someone their run) and the account
// pages.
import { h, fmt, session, sessionExpired, announceClicks } from '/scripts/site.js';
import { GOLDEN } from '/scripts/golden.js';

const API = '/api/clicks?action=golden';
const FACE = '/images/icons/mobile-icon-96.webp';
const SIZE = 76; // px, the button's size
const MIN_WAIT = 15 * 1000;
const MAX_WAIT = 10 * 60 * 1000;
const DONE_WAIT = 30 * 60 * 1000; // once today's are caught: just watching for midnight
const ERROR_WAIT = 5 * 60 * 1000;

let timer = null;
let askWhenSeen = false;
let out = null; // the button while he's on the page
let news = null;

function later(ms) {
  clearTimeout(timer);
  timer = setTimeout(ask, Math.min(DONE_WAIT, Math.max(MIN_WAIT, ms)));
}

function say(text) {
  if (!news) {
    news = h('span', { class: 'sr-only', role: 'status' });
    document.body.append(news);
  }
  news.textContent = text;
}

async function ask() {
  timer = null;
  if (!session.loggedIn || out) return;
  // A hidden tab waits until it's looked at again, so he only ever shows up for someone who can see him.
  if (document.visibilityState !== 'visible') { askWhenSeen = true; return; }
  try {
    const res = await fetch(API, { credentials: 'same-origin' });
    if (res.status === 401) { sessionExpired(); return; }
    const data = res.ok ? await res.json() : null;
    if (!data) return later(ERROR_WAIT);
    if (data.show && typeof data.show.token === 'string') return pop(data.show.token, Number(data.show.ms) || GOLDEN.show * 1000);
    if (Number.isFinite(data.wait)) return later(Math.min(MAX_WAIT, data.wait + 500));
    return later(DONE_WAIT);
  } catch {
    later(ERROR_WAIT);
  }
}

// A burst of "+N" and sparkles where he was caught.
function burst(x, y, text) {
  const el = h('span', { class: 'golden-burst', 'aria-hidden': 'true', style: { left: `${x}px`, top: `${y}px` } }, text);
  el.addEventListener('animationend', () => el.remove());
  document.body.append(el);
}

function pop(token, ms) {
  const x = Math.round(16 + Math.random() * Math.max(0, innerWidth - SIZE - 32));
  const top = Math.min(innerHeight * 0.35, 110);
  const y = Math.round(top + Math.random() * Math.max(0, innerHeight - top - SIZE - 24));
  const button = h('button', {
    type: 'button',
    class: 'golden-trusty',
    'aria-label': 'Golden Trusty! Catch him for bonus clicks',
    title: 'Golden Trusty! Catch him for bonus clicks',
    style: `left: ${x}px; top: ${y}px; --golden-ms: ${ms}ms`,
  }, h('img', { src: FACE, alt: '', width: 56, height: 56 }));
  out = button;
  say('A Golden Trusty showed up! Catch him for bonus clicks.');

  let gone = false;
  const leave = (wait) => {
    if (gone) return;
    gone = true;
    clearTimeout(away);
    button.classList.add('is-leaving');
    setTimeout(() => button.remove(), 300);
    out = null;
    later(wait);
  };
  const away = setTimeout(() => leave(60 * 1000), ms);

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    const rect = button.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    try {
      const res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.status === 401) { sessionExpired(); leave(DONE_WAIT); return; }
      const data = await res.json().catch(() => ({}));
      if (res.ok && Number(data.added) > 0) {
        burst(cx, cy, `+${fmt(data.added)}`);
        const more = data.left > 0 ? ` ${data.left === 1 ? 'One more' : `${fmt(data.left)} more`} to find today.` : ' That’s all of today’s.';
        say(`You caught a Golden Trusty: ${fmt(data.added)} clicks!${more}`);
        if (Number.isFinite(data.clicks)) announceClicks(data.clicks, data.added);
      } else {
        burst(cx, cy, 'Too slow!');
        say(data.error || 'That Golden Trusty got away.');
      }
    } catch {
      say('That Golden Trusty got away.');
    }
    leave(MIN_WAIT);
  });

  document.body.append(button);
}

let started = false;
export function startGolden() {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && askWhenSeen) {
      askWhenSeen = false;
      ask();
    }
  });
  ask();
}
