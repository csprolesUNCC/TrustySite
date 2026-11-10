// The online rooms, the page's side of the connection: whether they're open, tickets, and keeping a WebSocket
// to a Trusty Fever room (realtime/room.js) or a Trusty Blackjack table (realtime/table.js) going through
// hiccups. pages/games/fever.html and pages/games/casino.html do the rest. Also the click bank's GET, for the
// player's own clicks and limits (utils/bank.js).
import { sessionExpired } from './site.js';
import { CODE_LETTERS, ROOM_CODE } from './fever-net.js';

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

// A link to a room (kind 'room': fever.html#room=KXQT) or a table (kind 'table': casino.html#table=KXQT).
export function roomLink(code, kind = 'room') {
  return `${location.origin}${location.pathname}#${kind}=${code}`;
}

export function roomFromHash(kind = 'room', hash = location.hash) {
  const [, code] = new RegExp(`^#${kind}=([A-Za-z]{4})$`).exec(hash) || [];
  return code && ROOM_CODE.test(code.toUpperCase()) ? code.toUpperCase() : null;
}

// The logged-in player's clicks: { clicks, net, refunded, limits, month }, or null.
export async function bankStatus() {
  try {
    const res = await fetch('/api/leaderboard?action=bank', { credentials: 'same-origin' });
    if (res.status === 401) sessionExpired();
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Joins room or table `code` of `kind` ('room' or 'table'), speaking protocol `version` (make: opening it, so
// it has to be empty), and calls on.message(msg) for what it says, on.status(text, or null once connected
// again) and, when it's gone for good, on.gone(message, { code, login }). Returns { send(message), leave() }.
export function connect({ kind, code, version, make = false, on }) {
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
    if (tries >= RETRIES) return gone('Lost the connection.');
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
        return gone(pass.error || 'Online play isn’t open right now.');
      }
    } catch {
      return retry(); // offline for a moment
    }
    if (left) return;
    let why = '';
    ws = new WebSocket(`${pass.rooms}/${kind}/${code}?v=${version}&ticket=${encodeURIComponent(pass.ticket)}${creating ? '&make=1' : ''}`);
    ws.addEventListener('open', () => {
      tries = 0;
      pingedAt = 0;
      on.status(null);
    });
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (left || !msg) return;
      pingedAt = 0; // anything at all means it's still there
      if (msg.t === 'error') why = msg.message;
      else if (msg.t !== 'pong') on.message(msg);
    });
    ws.addEventListener('close', (e) => {
      if (left) return;
      // The room's own reasons (full, taken, opened somewhere else, closed for being idle) are final.
      if (e.code >= 4000 && e.code < 5000) return gone(why || e.reason || 'It closed.', { code: e.code });
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
