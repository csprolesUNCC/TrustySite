// The page's side of the lobby (realtime/lobby.js; messages in scripts/casino-feed.js): one WebSocket per page,
// shared by everything on it that wants to know who's here (the footer) or the casino's big wins (the Casino
// page). It only connects while online play is set up, closes a minute after the tab is hidden and opens again
// when it's back, so the count is people who are actually looking.
import { LOBBY_PROTOCOL, areaOf } from './casino-feed.js';

const HIDDEN_MS = 60000;
const PING_MS = 45000; // under Cloudflare's 100-second idle limit
const RETRIES = 4;
const ROOMS_KEY = 'trusty:rooms';

const listeners = new Set();
let state = null; // { here, casino, wins }
let ws = null;
let started = false;
let tries = 0;
let hiddenTimer = null;
let pinger = null;

function ssGet(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function ssSet(key, value) { try { sessionStorage.setItem(key, value); } catch { /* storage blocked */ } }

// Where the rooms are, from the same (CDN-cached) answer the online games use, kept for the visit.
async function lobbyUrl() {
  let rooms = ssGet(ROOMS_KEY);
  if (rooms === null) {
    try {
      const res = await fetch('/api/leaderboard?action=fever');
      const data = res.ok ? await res.json() : null;
      rooms = data && typeof data.rooms === 'string' ? data.rooms : '';
    } catch {
      return null; // offline: try again next time
    }
    ssSet(ROOMS_KEY, rooms);
  }
  return rooms ? `${rooms}/lobby?v=${LOBBY_PROTOCOL}&at=${areaOf(location.pathname)}` : null;
}

function tell(event) {
  for (const fn of listeners) {
    try { fn(state, event); } catch (error) { console.error(error); }
  }
}

async function open() {
  if (ws || document.visibilityState === 'hidden') return;
  const url = await lobbyUrl();
  if (!url || ws || document.visibilityState === 'hidden') return;
  const socket = new WebSocket(url);
  ws = socket;
  socket.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || ws !== socket) return;
    tries = 0;
    if (msg.t === 'lobby') {
      state = { here: msg.here, casino: msg.casino, wins: Array.isArray(msg.wins) ? msg.wins : [] };
      tell({ t: 'lobby' });
    } else if (msg.t === 'here' && state) {
      Object.assign(state, { here: msg.here, casino: msg.casino });
      tell({ t: 'here' });
    } else if (msg.t === 'win' && state && Array.isArray(msg.wins)) {
      state.wins = [...msg.wins.slice().reverse(), ...state.wins].slice(0, 10);
      tell({ t: 'win', wins: msg.wins });
    }
  });
  socket.addEventListener('close', (e) => {
    if (ws !== socket) return;
    ws = null;
    clearInterval(pinger);
    if (e.code === 4006 || e.code === 4002 || document.visibilityState === 'hidden') return; // outdated or full: stay off
    if (tries >= RETRIES) return;
    tries += 1;
    setTimeout(open, 2000 * 2 ** tries);
  });
  clearInterval(pinger);
  pinger = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send('{"t":"ping"}');
  }, PING_MS);
}

function close() {
  if (!ws) return;
  const socket = ws;
  ws = null;
  clearInterval(pinger);
  socket.close(1000, 'Away');
}

function start() {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (document.visibilityState === 'hidden') hiddenTimer = setTimeout(close, HIDDEN_MS);
    else {
      tries = 0;
      open();
    }
  });
  addEventListener('pagehide', close); // an open WebSocket keeps the page out of the back/forward cache
  addEventListener('pageshow', (e) => { if (e.persisted) open(); });
  open();
}

/**
 * Calls fn(state, event) whenever the lobby says something: state is { here, casino, wins } (wins newest first),
 * event { t: 'lobby' | 'here' | 'win', wins? }. Nothing is called while online play isn't set up.
 */
export function onLobby(fn) {
  listeners.add(fn);
  if (state) fn(state, { t: 'lobby' });
  start();
  return () => listeners.delete(fn);
}
