// Trusty Fever's online rooms, on Cloudflare: a Worker that checks each player's ticket, and one Durable
// Object per room code, so everyone in a room reaches the same single place and the match can live in memory.
// The rules are in realtime/room.js; this file only connects it to WebSockets and a timer.
//   wss://<this worker>/room/<CODE>?v=<PROTOCOL>&ticket=<ticket>[&make=1]
// Deploy with `npm run deploy` in this folder (see "Trusty Fever online" in CLAUDE.md for the whole setup). The
// deploy bundles its own copy of scripts/fever-engine.js and scripts/fever-net.js, so deploy again whenever
// those or this folder change.
import { Room, ROOM_CODE, CLOSE, versionProblem } from './room.js';
import { verifyTicket } from '../utils/fever-ticket.js';

export class FeverRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
    this.timer = null;
    this.every = 0;
  }

  // Only the Worker below calls this, after checking the ticket; it passes the player in X-Fever-User.
  async fetch(request) {
    const url = new URL(request.url);
    const user = JSON.parse(request.headers.get('X-Fever-User'));
    this.room ??= new Room(url.searchParams.get('code'));
    const [client, socket] = Object.values(new WebSocketPair());
    socket.accept();
    const conn = {
      send(text) {
        try { socket.send(text); } catch { /* already closed */ }
      },
      close(code, reason) {
        try { socket.close(code, reason); } catch { /* already closed */ }
      },
    };
    socket.addEventListener('message', (e) => this.run(() => this.room.receive(conn, typeof e.data === 'string' ? e.data : '')));
    socket.addEventListener('close', () => {
      conn.close(1000, 'Bye'); // answer the player's close, or the socket stays half open
      this.run(() => this.room.leave(conn));
    });
    socket.addEventListener('error', () => this.run(() => this.room.leave(conn)));
    this.run(() => this.room.join(conn, user, { make: url.searchParams.get('make') === '1' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  run(fn) {
    fn();
    // Tick as often as the room wants: every few ms during a match, now and then in the lobby, never when
    // it's empty, so an empty room can be put away.
    const every = this.room.tickEvery();
    if (every === this.every) return;
    clearInterval(this.timer);
    this.every = every;
    this.timer = every ? setInterval(() => this.run(() => this.room.tick()), every) : null;
  }
}

// A WebSocket that only says why it can't stay: browsers can't read the status of a refused connection.
function refuse(code, message) {
  const [client, socket] = Object.values(new WebSocketPair());
  socket.accept();
  socket.send(JSON.stringify({ t: 'error', message }));
  socket.close(code, message);
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const [, code] = url.pathname.match(/^\/room\/([A-Z]{4})$/) || [];
    if (!code || !ROOM_CODE.test(code)) {
      return url.pathname === '/'
        ? new Response('Trusty Fever rooms are open.\n')
        : new Response('Not found\n', { status: 404 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket\n', { status: 426 });
    const outdated = versionProblem(url.searchParams.get('v'));
    if (outdated) return refuse(CLOSE.version, outdated);
    const user = await verifyTicket(url.searchParams.get('ticket'), env.FEVER_SECRET);
    if (!user) return refuse(CLOSE.ticket, 'Couldn’t check who you are. Try again.');
    const headers = new Headers(request.headers);
    headers.set('X-Fever-User', JSON.stringify(user));
    const room = env.ROOMS.get(env.ROOMS.idFromName(code));
    const make = url.searchParams.get('make') === '1' ? '&make=1' : '';
    return room.fetch(`https://room/?code=${code}${make}`, { headers });
  },
};
