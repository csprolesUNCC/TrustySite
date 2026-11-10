// What Trusty Fever's rooms (realtime/room.js) and Trusty Blackjack's tables (realtime/table.js) share.

// Why the room server closed a connection (4001 is the worker's: the ticket didn't check out).
export const CLOSE = { ticket: 4001, full: 4002, taken: 4003, replaced: 4004, idle: 4005, version: 4006, flood: 4007 };

// Steering sends a message per press and release, so even frantic play is a few dozen a second. Every message
// counts against Cloudflare's free allowance, so a connection sending far more than that gets closed.
const MAX_PER_SECOND = 100;

export function send(conn, message) {
  conn.send(typeof message === 'string' ? message : JSON.stringify(message));
}

// Says why, then closes. Returns false, for join().
export function refuse(conn, code, message) {
  send(conn, { t: 'error', message });
  conn.close(code, message);
  return false;
}

// Counts a message from `person` and says whether they're over the limit.
export function flooding(person, now) {
  const second = Math.floor(now / 1000);
  if (second !== person.second) {
    person.second = second;
    person.sent = 0;
  }
  person.sent += 1;
  return person.sent > MAX_PER_SECOND;
}

// The JSON object in a message, or null.
export function parse(data, maxLength) {
  if (typeof data !== 'string' || data.length > maxLength) return null;
  try {
    const msg = JSON.parse(data);
    return msg && typeof msg === 'object' && !Array.isArray(msg) ? msg : null;
  } catch {
    return null;
  }
}

// 16 hex digits: ids for bets and pots at the click bank.
export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
