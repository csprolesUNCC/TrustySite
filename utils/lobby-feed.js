import { roomsUrl } from './fever-online.js';
import { signPayload } from './fever-ticket.js';

// Tells the lobby (realtime/lobby.js, next to the online rooms on Cloudflare) about big wins as the click bank
// pays them, so the casino page's feed shows them live (scripts/casino-feed.js). Signed with FEVER_SECRET like
// the room server's requests to the bank, so nobody else can post a win. It never holds up or breaks a payout:
// it gives up after a moment, and a win it couldn't tell just isn't in the feed. Nothing happens while online
// play isn't set up (no FEVER_ROOMS_URL).

const WAIT_MS = 1500;

export async function announceWins(wins, { fetch: post = (...args) => fetch(...args), now = Date.now() } = {}) {
  if (!wins.length) return false;
  const rooms = roomsUrl();
  if (!rooms) return false;
  try {
    const payload = JSON.stringify({ wins, ts: now });
    const sig = await signPayload(payload, process.env.FEVER_SECRET);
    const res = await post(`${rooms.replace(/^ws/, 'http')}/lobby/win`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, sig }),
      signal: AbortSignal.timeout(WAIT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
