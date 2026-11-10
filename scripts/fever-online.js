// Trusty Fever online, the page's side of the connection: whether rooms are open, tickets, and keeping a
// WebSocket to a room (realtime/room.js) going through hiccups. pages/games/fever.html does the rest.
import { sessionExpired } from './site.js';
import { CODE_LETTERS, ROOM_CODE, PROTOCOL } from './fever-net.js';

export { ROOM_CODE };

const API = '/api/leaderboard?action=fever';
const RETRIES = 5;
const PING_MS = 15000;

let open = null;
/** Whether online play is set up (the server knows a room server). Asks once per page. */
export function roomsOpen() {
  open ??= fetch(API)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => Boolean(data && typeof data.rooms === 'string' && data.rooms))
    .catch(() => false);
  return open;
}

export function newCode() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => CODE_LETTERS[n % CODE_LETTERS.length]).join('');
}

export function roomLink(code) {
  return `${location.origin}${location.pathname}#room=${code}`;
}

export function roomFromHash(hash = location.hash) {
  const [, code] = /^#room=([A-Za-z]{4})$/.exec(hash) || [];
  return code && ROOM_CODE.test(code.toUpperCase()) ? code.toUpperCase() : null;
}

// Joins room `code` (make: creating it, so it has to be empty) and calls on.room(msg), on.match(msg),
// on.steps(list), on.status(text, or null once connected again) and, when the room is gone for good,
// on.gone(message, { code, login }). Returns { send(message), leave() }.
export function connect(code, { make = false, on }) {
  let ws = null;
  let left = false;
  let tries = 0;
  let pingedAt = 0;

  function gone(message, extra = {}) {
    if (left) return;
    left = true;
    clearInterval(pinger);
    on.gone(message, extra);
  }

  function retry() {
    if (left) return;
    if (tries >= RETRIES) return gone('Lost the connection to the room.');
    tries += 1;
    on.status('Reconnecting…');
    setTimeout(() => attempt(false), 700 * tries);
  }

  async function attempt(creating) {
    let pass;
    try {
      const res = await fetch(API, { method: 'POST', credentials: 'same-origin' });
      if (res.status === 401) {
        sessionExpired();
        return gone('Log in to play online.', { login: true });
      }
      pass = await res.json().catch(() => ({}));
      if (!res.ok || typeof pass.ticket !== 'string' || typeof pass.rooms !== 'string') {
        return gone(pass.error || 'Online Trusty Fever isn’t open right now.');
      }
    } catch {
      return retry(); // offline for a moment
    }
    if (left) return;
    let why = '';
    ws = new WebSocket(`${pass.rooms}/room/${code}?v=${PROTOCOL}&ticket=${encodeURIComponent(pass.ticket)}${creating ? '&make=1' : ''}`);
    ws.addEventListener('open', () => {
      tries = 0;
      pingedAt = 0;
      on.status(null);
    });
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (left || !msg) return;
      if (msg.t === 'room') on.room(msg);
      else if (msg.t === 'match') on.match(msg);
      else if (msg.t === 'steps') on.steps(msg.s);
      else if (msg.t === 'error') why = msg.message;
      pingedAt = 0; // anything at all means it's still there
    });
    ws.addEventListener('close', (e) => {
      if (left) return;
      // The room's own reasons (full, taken, opened somewhere else, closed for being idle) are final.
      if (e.code >= 4000 && e.code < 5000) return gone(why || e.reason || 'The room closed.', { code: e.code });
      retry();
    });
  }

  // A ping now and then: if one goes unanswered, the connection is dead even if the browser hasn't noticed.
  const pinger = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (pingedAt && Date.now() - pingedAt > PING_MS / 2) {
      ws.close();
      return;
    }
    pingedAt = Date.now();
    ws.send('{"t":"ping"}');
  }, PING_MS);

  attempt(make);
  return {
    send(message) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    leave() {
      left = true;
      clearInterval(pinger);
      if (ws) ws.close(1000, 'Left');
    },
  };
}
