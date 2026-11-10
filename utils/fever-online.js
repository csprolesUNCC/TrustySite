import { authenticateUser } from './auth.js';
import { signTicket, SECRET_MIN } from './fever-ticket.js';

// Trusty Fever's online rooms (pages/games/fever.html), served from api/leaderboard.js as ?action=fever so it
// doesn't take up another Vercel function. The rooms themselves run on Cloudflare (realtime/), because Vercel
// Functions can't keep a room together: their WebSockets close after 5 minutes on the Hobby plan, and two
// players' connections can land on different machines.
//   GET: { rooms }, the room server's address, or null while online play isn't set up (FEVER_ROOMS_URL and
//     FEVER_SECRET unset). Public and the same for everyone, so Vercel's CDN keeps it for 5 minutes.
//   POST: { rooms, ticket } for the logged-in player: a ticket the room server checks (utils/fever-ticket.js),
//     since the login cookie doesn't reach it.

function roomsUrl() {
  const url = process.env.FEVER_ROOMS_URL;
  const secret = process.env.FEVER_SECRET;
  if (!url || !secret) return null;
  if (secret.length < SECRET_MIN) {
    console.error(`FEVER_SECRET needs at least ${SECRET_MIN} characters, so online Trusty Fever is off.`);
    return null;
  }
  if (!/^wss:\/\/[^/?#\s]+\/?$/.test(url)) {
    console.error('FEVER_ROOMS_URL should look like wss://trusty-fever.<you>.workers.dev, so online Trusty Fever is off.');
    return null;
  }
  return url.replace(/\/$/, '');
}

export default async function feverOnline(req, res) {
  try {
    const rooms = roomsUrl();
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Vercel-CDN-Cache-Control', 'max-age=300');
      return res.status(200).json({ rooms });
    }
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    res.setHeader('Cache-Control', 'no-store');
    const user = authenticateUser(req);
    if (!user || typeof user.username !== 'string' || !user.username || user.userId == null) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!rooms) return res.status(503).json({ error: 'Online Trusty Fever isn’t open right now.' });
    const ticket = await signTicket({ id: String(user.userId), name: user.username }, process.env.FEVER_SECRET);
    return res.status(200).json({ rooms, ticket });
  } catch (error) {
    console.error('Fever API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
