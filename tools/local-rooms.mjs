// Trusty Fever's online rooms for tools/dev-server.mjs: the same Room (realtime/room.js) the Cloudflare
// Worker runs, behind a tiny WebSocket server, so online play works locally with no Cloudflare account.
//   ws://localhost:<port>/fever-rooms/room/<CODE>?v=<PROTOCOL>&ticket=...[&make=1]
import crypto from 'node:crypto';
import { Room, ROOM_CODE, CLOSE, versionProblem } from '../realtime/room.js';
import { verifyTicket } from '../utils/fever-ticket.js';

export const LOCAL_ROOMS_PATH = '/fever-rooms';

// Just enough of RFC 6455 for browsers: text messages, ping/pong and close. (Frames from browsers are masked.)
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const hash = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${hash}\r\n\r\n`);
  socket.setNoDelay(true);

  const on = { message() {}, close() {} };
  let closed = false;
  let buffer = Buffer.alloc(0);
  let parts = [];
  const frame = (opcode, payload) => {
    const n = payload.length;
    let head;
    if (n < 126) head = Buffer.from([0x80 | opcode, n]);
    else if (n < 65536) head = Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]);
    else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | opcode;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(n), 2);
    }
    if (!socket.destroyed) socket.write(Buffer.concat([head, payload]));
  };
  const finish = () => {
    if (closed) return;
    closed = true;
    on.close();
  };
  const conn = {
    send(text) {
      if (!closed) frame(1, Buffer.from(text));
    },
    close(code = 1000, reason = '') {
      if (closed) return;
      const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
      payload.writeUInt16BE(code);
      payload.write(reason, 2);
      frame(8, payload);
      socket.end();
      finish();
    },
  };
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let at = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        at = 10;
      }
      const maskAt = at;
      if (masked) at += 4;
      if (buffer.length < at + length) return;
      const payload = Buffer.from(buffer.subarray(at, at + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buffer[maskAt + (i & 3)];
      buffer = buffer.subarray(at + length);
      if (opcode === 8) { // the browser is closing: say goodbye back
        conn.close(1000);
        return;
      }
      if (opcode === 9) frame(10, payload);
      if (opcode >= 8) continue;
      parts.push(payload);
      if (!fin) continue;
      const text = Buffer.concat(parts).toString('utf8');
      parts = [];
      on.message(text);
    }
  });
  socket.on('close', finish);
  socket.on('error', () => socket.destroy());
  return { conn, on };
}

// Sends Trusty Fever room connections on `server` to local rooms. Tickets are checked with `secret`.
export function attachRooms(server, secret) {
  const rooms = new Map(); // code -> { room, timer, every }

  function run(entry, code, fn) {
    fn();
    const every = entry.room.tickEvery();
    if (every !== entry.every) {
      clearInterval(entry.timer);
      entry.every = every;
      entry.timer = every ? setInterval(() => run(entry, code, () => entry.room.tick()), every) : null;
    }
    if (!every && !entry.room.people.length) rooms.delete(code);
  }

  server.on('upgrade', async (req, socket) => {
    const url = new URL(req.url, 'http://localhost');
    const [, code] = url.pathname.match(new RegExp(`^${LOCAL_ROOMS_PATH}/room/([A-Z]{4})$`)) || [];
    if (!code || !ROOM_CODE.test(code)) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    const user = await verifyTicket(url.searchParams.get('ticket'), secret);
    const ws = accept(req, socket);
    if (!ws) return;
    const outdated = versionProblem(url.searchParams.get('v'));
    if (outdated) {
      ws.conn.send(JSON.stringify({ t: 'error', message: outdated }));
      ws.conn.close(CLOSE.version, 'Outdated');
      return;
    }
    if (!user) {
      ws.conn.send(JSON.stringify({ t: 'error', message: 'Couldn’t check who you are. Try again.' }));
      ws.conn.close(CLOSE.ticket, 'Bad ticket');
      return;
    }
    if (!rooms.has(code)) rooms.set(code, { room: new Room(code), timer: null, every: 0 });
    const entry = rooms.get(code);
    ws.on.message = (text) => run(entry, code, () => entry.room.receive(ws.conn, text));
    ws.on.close = () => run(entry, code, () => entry.room.leave(ws.conn));
    run(entry, code, () => entry.room.join(ws.conn, user, { make: url.searchParams.get('make') === '1' }));
  });
}
