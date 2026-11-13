// The online rooms, on Cloudflare: a Worker that checks each player's ticket, and one Durable Object per code,
// so everyone in a room reaches the same single place and the game can live in memory. Trusty Fever's rooms
// are realtime/room.js, Trusty Blackjack's tables realtime/table.js and Trusty Craps' tables
// realtime/craps-table.js; this file only connects them to WebSockets, a timer and the click bank
// (realtime/bank.js, which calls the site at SITE_URL).
//   wss://<this worker>/room/<CODE>?v=<PROTOCOL>&ticket=<ticket>[&make=1]         Trusty Fever
//   wss://<this worker>/table/<CODE>?v=<TABLE_PROTOCOL>&ticket=<ticket>[&make=1]  Trusty Blackjack
//   wss://<this worker>/craps/<CODE>?v=<CRAPS_PROTOCOL>&ticket=<ticket>[&make=1]  Trusty Craps
// Deploy with `npm run deploy` in this folder (see "Trusty Fever online" in CLAUDE.md for the whole setup). The
// deploy bundles its own copy of the game files it imports (scripts/fever-engine.js, scripts/fever-net.js,
// scripts/blackjack.js, scripts/craps.js), so deploy again whenever those or this folder change.
import { Room, ROOM_CODE, versionProblem as feverVersion } from './room.js';
import { Table, versionProblem as tableVersion } from './table.js';
import { CrapsTable as Craps, versionProblem as crapsVersion } from './craps-table.js';
import { CLOSE } from './common.js';
import { bankClient } from './bank.js';
import { verifyTicket } from '../utils/fever-ticket.js';

const KINDS = {
  room: { binding: 'ROOMS', version: feverVersion, open: (code, bank) => new Room(code, { bank }) },
  table: { binding: 'TABLES', version: tableVersion, open: (code, bank) => new Table(code, { bank }) },
  craps: { binding: 'CRAPS', version: crapsVersion, open: (code, bank) => new Craps(code, { bank }) },
};

class Host {
  constructor(ctx, env, kind) {
    this.ctx = ctx;
    this.env = env;
    this.kind = kind;
    this.room = null;
    this.timer = null;
    this.every = 0;
    this.bank = bankClient({ siteUrl: env.SITE_URL || 'https://trustydahorse.com', secret: env.FEVER_SECRET });
  }

  // Only the Worker below calls this, after checking the ticket; it passes the player in X-Fever-User.
  async fetch(request) {
    const url = new URL(request.url);
    const user = JSON.parse(request.headers.get('X-Fever-User'));
    this.room ??= KINDS[this.kind].open(url.searchParams.get('code'), this.bank);
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

  // Runs something in the room, then ticks as often as the room now wants. Some things wait on the bank (they
  // return a promise), and may want different ticks once it answers.
  run(fn) {
    const result = fn();
    this.schedule();
    if (result && typeof result.then === 'function') {
      result.then(() => this.schedule(), (error) => {
        console.error(error);
        this.schedule();
      });
    }
  }

  schedule() {
    const every = this.room.tickEvery();
    if (every === this.every) return;
    clearInterval(this.timer);
    this.every = every;
    this.timer = every ? setInterval(() => this.run(() => this.room.tick()), every) : null;
  }
}

export class FeverRoom extends Host {
  constructor(ctx, env) {
    super(ctx, env, 'room');
  }
}

export class BlackjackTable extends Host {
  constructor(ctx, env) {
    super(ctx, env, 'table');
  }
}

export class CrapsTable extends Host {
  constructor(ctx, env) {
    super(ctx, env, 'craps');
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
    const [, kind, code] = url.pathname.match(/^\/(room|table|craps)\/([A-Z]{4})$/) || [];
    if (!kind || !ROOM_CODE.test(code)) {
      return url.pathname === '/'
        ? new Response('Trusty’s online rooms are open.\n')
        : new Response('Not found\n', { status: 404 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket\n', { status: 426 });
    const outdated = KINDS[kind].version(url.searchParams.get('v'));
    if (outdated) return refuse(CLOSE.version, outdated);
    const user = await verifyTicket(url.searchParams.get('ticket'), env.FEVER_SECRET);
    if (!user) return refuse(CLOSE.ticket, 'Couldn’t check who you are. Try again.');
    const headers = new Headers(request.headers);
    headers.set('X-Fever-User', JSON.stringify(user));
    const rooms = env[KINDS[kind].binding];
    const make = url.searchParams.get('make') === '1' ? '&make=1' : '';
    return rooms.get(rooms.idFromName(code)).fetch(`https://room/?code=${code}${make}`, { headers });
  },
};
