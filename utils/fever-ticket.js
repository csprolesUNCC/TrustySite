// Trust between the site and the room server (realtime/), which share FEVER_SECRET and nobody else knows it.
//   Tickets: the login cookie never reaches the room server (it's on another host), so utils/fever-online.js
//     hands a logged-in player a ticket, and the room server checks it before letting them in. A ticket is
//     "<payload>.<signature>", both base64url: the payload is the JSON { id, name, exp } and the signature its
//     HMAC-SHA256 with FEVER_SECRET.
//   Signed requests: the room server tells the click bank (utils/bank.js) about bets with { payload, sig }, a
//     JSON string and its signature, so nobody else can move clicks.
// Web Crypto only, so the same file runs on Vercel, on Cloudflare and in the tests.

export const TICKET_SECONDS = 60; // only long enough to open the connection
export const SECRET_MIN = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('not base64url');
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

const keyFor = (secret) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** A ticket for the player { id, name }, good for TICKET_SECONDS. */
export async function signTicket({ id, name }, secret, now = Date.now()) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ id, name, exp: Math.floor(now / 1000) + TICKET_SECONDS })));
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The player { id, name } a ticket is for, or null if it's forged, expired or junk. */
export async function verifyTicket(ticket, secret, now = Date.now()) {
  if (typeof ticket !== 'string' || ticket.length > 1000 || typeof secret !== 'string' || secret.length < SECRET_MIN) return null;
  const parts = ticket.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  try {
    const ok = await crypto.subtle.verify('HMAC', await keyFor(secret), fromBase64Url(signature), encoder.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(decoder.decode(fromBase64Url(payload)));
    if (!data || typeof data.id !== 'string' || !data.id || typeof data.name !== 'string' || !data.name) return null;
    if (!Number.isSafeInteger(data.exp) || data.exp * 1000 < now) return null;
    return { id: data.id, name: data.name };
  } catch {
    return null;
  }
}

/** The signature of a JSON string, for a request to the bank. */
export async function signPayload(payload, secret) {
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(payload))));
}

/** Whether `sig` is the signature of `payload`. */
export async function verifyPayload(payload, sig, secret) {
  if (typeof payload !== 'string' || typeof sig !== 'string' || payload.length > 20000 || typeof secret !== 'string' || secret.length < SECRET_MIN) return false;
  try {
    return await crypto.subtle.verify('HMAC', await keyFor(secret), fromBase64Url(sig), encoder.encode(payload));
  } catch {
    return false;
  }
}
