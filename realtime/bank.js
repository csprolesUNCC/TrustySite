// The room server's line to the click bank (utils/bank.js, ?action=bank on the site). Every request is signed
// with FEVER_SECRET (utils/fever-ticket.js), so only this server can move clicks. A bet or a payout that gets
// lost on the way is simply sent again: the bank does each bet and each payout once, however often it's asked.
import { signPayload } from '../utils/fever-ticket.js';

const UNREACHABLE = 'Couldn’t reach the click bank. Try again in a moment.';

export function bankClient({ siteUrl, secret, fetch: get = (...args) => fetch(...args) }) {
  async function call(body, tries) {
    // One timestamp for every try, so a retry is the same request (the bank refuses ones over a minute old).
    const payload = JSON.stringify({ ...body, ts: Date.now() });
    const sig = await signPayload(payload, secret);
    for (let i = 0; i < tries; i++) {
      try {
        const res = await get(`${siteUrl}/api/leaderboard?action=bank`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, sig }),
        });
        const data = await res.json().catch(() => null);
        if (res.status === 403) return { ok: false, error: 'The click bank isn’t set up right: FEVER_SECRET doesn’t match on the site and the room server.' };
        if (data && res.status < 500) return data;
      } catch { /* the network: try again */ }
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
    return { ok: false, error: UNREACHABLE };
  }
  return {
    stake: (bet) => call({ op: 'stake', ...bet }, 2),
    settle: (bets) => call({ op: 'settle', bets }, 5),
    pot: (pot) => call({ op: 'pot', ...pot }, 5),
  };
}

// For the tests and tools/dev-server.mjs: a bank that never says yes.
export const noBank = {
  stake: async () => ({ ok: false, error: 'There’s no click bank here.' }),
  settle: async () => ({ ok: true, balances: {} }),
  pot: async () => ({ ok: true, balances: {} }),
};
