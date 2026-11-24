// The lobby: one Durable Object for the whole site that every page connects to (scripts/presence.js), so it can
// say how many people are here right now and pass the casino's big wins on live. The rules and messages are
// scripts/casino-feed.js; tools/local-rooms.mjs runs the same lobby for the dev server.
//   wss://<this worker>/lobby?v=<LOBBY_PROTOCOL>&at=<site|casino>   a page (no ticket: it's only listening)
//   POST https://<this worker>/lobby/win { payload, sig }           the click bank (utils/lobby-feed.js)
//
// Pages sit on it for as long as they're open, so it uses the WebSocket Hibernation API: between messages the
// object is put away and costs nothing, and pings are answered without waking it up.
import { verifyPayload } from '../utils/fever-ticket.js';
import { LOBBY_PROTOCOL, addWins, counts, cleanWin, COUNT_EVERY } from '../scripts/casino-feed.js';

const MAX_CONNECTIONS = 5000;
const PER_ADDRESS = 12; // tabs from one IP address
const MAX_WINS = 20;    // in one message from the bank
const PING = '{"t":"ping"}';

export function lobbyVersionProblem(v) {
  return v === String(LOBBY_PROTOCOL) ? null : 'The site was just updated: reload the page.';
}

/** The wins in a request from the bank, or null if it isn't one (unsigned, over a minute old, or junk). */
export async function checkWins(body, secret, now = Date.now()) {
  if (!body || typeof body !== 'object' || !(await verifyPayload(body.payload, body.sig, secret))) return null;
  let data;
  try { data = JSON.parse(body.payload); } catch { return null; }
  if (!data || !Number.isSafeInteger(data.ts) || Math.abs(now - data.ts) > 60000) return null;
  if (!Array.isArray(data.wins) || data.wins.length > MAX_WINS) return null;
  return data.wins.map(cleanWin).filter(Boolean);
}

export class Lobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.wins = null;
    this.timer = null;
    // A ping is answered right here, without waking the object (or counting as its time).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, '{"t":"pong"}'));
  }

  async feed() {
    this.wins ??= (await this.ctx.storage.get('wins')) || [];
    return this.wins;
  }

  // Only the Worker below calls this: a page connecting (after checking its version), or a win it checked.
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/win') {
      const wins = await request.json();
      this.wins = addWins(await this.feed(), wins);
      await this.ctx.storage.put('wins', this.wins);
      this.sendAll(JSON.stringify({ t: 'win', wins: wins.slice().sort((a, b) => a.at - b.at) }));
      return new Response('ok');
    }
    const area = url.searchParams.get('at') === 'casino' ? 'casino' : 'site';
    const ip = request.headers.get('X-Lobby-IP') || '';
    if (this.open().length >= MAX_CONNECTIONS) return refuse('The lobby is full right now.');
    if (ip && this.open(`ip:${ip}`).length >= PER_ADDRESS) return refuse('That’s a lot of tabs.');
    const [client, socket] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(socket, [`area:${area}`, ...(ip ? [`ip:${ip}`] : [])]);
    const { here, casino } = this.counts();
    socket.send(JSON.stringify({ t: 'lobby', here, casino, wins: await this.feed() }));
    this.soon();
    return new Response(null, { status: 101, webSocket: client });
  }

  // Pages only ever ping (answered above): anything else is someone poking at it.
  webSocketMessage(ws) {
    try { ws.close(1008, 'The lobby only listens.'); } catch { /* already closed */ }
    this.soon();
  }

  webSocketClose(ws) {
    try { ws.close(1000, 'Bye'); } catch { /* already closed */ }
    this.soon();
  }

  webSocketError() {
    this.soon();
  }

  open(tag) {
    return this.ctx.getWebSockets(tag).filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  counts() {
    return counts(this.open().map((ws) => (this.ctx.getTags(ws).includes('area:casino') ? 'casino' : 'site')));
  }

  // New counts go out a moment after someone comes or goes, one message for everyone who did in that time.
  soon() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sendAll(JSON.stringify(this.counts()));
    }, COUNT_EVERY);
  }

  sendAll(text) {
    for (const ws of this.open()) {
      try { ws.send(text); } catch { /* closing */ }
    }
  }
}

function refuse(message, code = 4002) {
  const [client, socket] = Object.values(new WebSocketPair());
  socket.accept();
  socket.send(JSON.stringify({ t: 'error', message }));
  socket.close(code, message);
  return new Response(null, { status: 101, webSocket: client });
}

// The Worker's side: the lobby's two addresses. Returns a Response, or null if the request isn't for the lobby.
export async function lobbyFetch(request, env) {
  const url = new URL(request.url);
  const lobby = () => env.LOBBY.get(env.LOBBY.idFromName('lobby'));
  if (url.pathname === '/lobby/win') {
    if (request.method !== 'POST') return new Response('Method not allowed\n', { status: 405 });
    const wins = await checkWins(await request.json().catch(() => null), env.FEVER_SECRET);
    if (!wins) return new Response('Forbidden\n', { status: 403 });
    if (wins.length) await lobby().fetch('https://lobby/win', { method: 'POST', body: JSON.stringify(wins) });
    return new Response('ok\n');
  }
  if (url.pathname !== '/lobby') return null;
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket\n', { status: 426 });
  const outdated = lobbyVersionProblem(url.searchParams.get('v'));
  if (outdated) return refuse(outdated, 4006);
  const headers = new Headers(request.headers);
  headers.set('X-Lobby-IP', request.headers.get('CF-Connecting-IP') || '');
  return lobby().fetch(`https://lobby/?at=${url.searchParams.get('at') === 'casino' ? 'casino' : 'site'}`, { headers });
}
