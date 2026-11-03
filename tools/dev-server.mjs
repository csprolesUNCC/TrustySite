// A local stand-in for Vercel with a pretend API, so every page renders (leaderboards, profiles, the Latest
// Update...) without MongoDB or any keys. For looking at the frontend and for tools/smoke.mjs; `vercel dev`
// is still the way to run the real API.
//   node tools/dev-server.mjs [port]        (npm run dev:mock)
// Log in by setting the cookie mock=in (tools/smoke.mjs does) plus the site's usual localStorage flag.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { courseNumber, DAILY_TRIES } from '../scripts/flappy-daily.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.glb': 'model/gltf-binary', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

const NAMES = ['carson', 'luke', 'hayhound', 'neigh_sayer', 'stickfig', 'pencilpusher', 'margins', 'tractorfan', 'mane_event', 'gallop'];
const board = (scoreKey, nameKey, top) => NAMES.map((name, i) => ({ [nameKey]: name, [scoreKey]: top - i * Math.round(top / 14) }));
const loggedIn = (req) => /(?:^|;\s*)mock=in(?:;|$)/.test(req.headers.cookie || '');
const today = () => new Date().toISOString().slice(0, 10);
let daily = { day: 0, best: 0, tries: 0 }; // the logged-in player's Daily Flappy, until the server restarts

function api(req, url, body) {
  const p = url.pathname;
  const action = url.searchParams.get('action');
  const me = loggedIn(req);
  if (p === '/api/auth/login') return me ? [200, { isLoggedIn: true, username: 'carson', isAdmin: true }] : [401, { isLoggedIn: false }];
  if (p === '/api/auth/logout') return [200, { message: 'Logged out' }];
  if (p.startsWith('/api/auth/')) return [400, { message: 'The pretend API doesn’t do accounts.' }];
  if (p === '/api/clicks') return me ? [200, { clicks: 12345, added: 5 }] : [401, { error: 'Authentication required' }];
  if (p === '/api/leaderboard') {
    if (action === 'update') return [200, { date: today(), headline: 'Pretend update!', text: 'This is tools/dev-server.mjs talking, not the real API.' }];
    if (action === 'trustis') return [200, url.searchParams.get('personal') ? { highScore: 5000 } : board('score', 'name', 90000)];
    if (action === 'flappy-daily') {
      const day = courseNumber();
      if (daily.day !== day) daily = { day, best: 0, tries: 0 };
      if (req.method === 'POST') {
        if (!me) return [401, { error: 'Authentication required' }];
        if (body.day !== day) return [409, { error: 'New course', day }];
        if (daily.tries >= DAILY_TRIES) return [409, { error: 'Out of tries', ...daily }];
        daily = { day, best: Math.max(daily.best, Number(body.score) || 0), tries: daily.tries + 1 };
        return [200, daily];
      }
      if (url.searchParams.get('personal')) return [200, me ? daily : { day, best: 0, tries: 0 }];
      return [200, board('score', 'name', 30)];
    }
    if (action === 'profile' && req.method === 'GET') {
      const u = url.searchParams.get('u') || 'carson';
      return [200, {
        username: u, memberSince: '2025-11-20T00:00:00Z', isMe: me && u === 'carson', rename: me && u === 'carson' ? { admin: true, next: null } : null,
        bio: 'Professional Trusty enjoyer.', clicks: { total: 12345, rank: 3 }, flappy: { score: 42, rank: 2 }, draw: null,
        trustis: { score: 90000, rank: 1, lines: 120, level: 13 },
        trustle: { played: 20, won: 18, streak: 4, best: 9, dist: [0, 2, 5, 6, 4, 1] }, tv: { trusty: 3600, snn: 600 },
      }];
    }
    if (action === 'admin') {
      if (!me) return [401, { error: 'Authentication required' }];
      const view = url.searchParams.get('view');
      if (view === 'users') return [200, { users: NAMES.map((username, i) => ({ username, createdAt: new Date(Date.now() - i * 864e5).toISOString(), flags: [] })) }];
      return [200, { drawings: [] }];
    }
    if (req.method !== 'GET') return [200, {}];
    return [200, board('clicks', 'username', 50000)];
  }
  if (p === '/api/flappy-api') return [200, action === 'personal' ? { highScore: 12 } : req.method === 'POST' ? { message: 'Score updated!' } : board('score', 'name', 60)];
  if (p === '/api/draw-api') {
    if (action === 'get_personal') return [200, { highScore: 70 }];
    if (action === 'get_leaderboard') return [200, board('score', 'name', 92).map((e, i) => ({ ...e, drawing: null, id: `${i}`.padStart(24, '0'), at: new Date().toISOString() }))];
    return [200, { message: 'Score saved!', score: 50 }];
  }
  if (p === '/api/trustle-api') return [200, req.method === 'GET' ? { players: 40, dist: [1, 4, 10, 12, 8, 3], lost: 2 } : { games: {} }];
  if (p === '/api/gemini') return [200, { reply: 'whaddup. (This is the pretend API: run `vercel dev` to talk to the real Trusty.)' }];
  return [404, { error: 'Not found' }];
}

export function startServer(port = 8787) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    res.setHeader('Date', new Date().toUTCString());
    if (url.pathname.startsWith('/api/')) {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let sent = {};
        try { sent = raw ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
        const [status, answer] = api(req, url, sent);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(answer));
      });
      return;
    }
    if (url.pathname.startsWith('/_vercel/')) { // Vercel Analytics only exists on Vercel
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end('');
      return;
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    let status = 200;
    if (!fs.existsSync(file) || /(^|\/)(node_modules|\.git|api|utils|tests|tools)(\/|$)/.test(path.relative(ROOT, file))) {
      status = 404;
      file = path.join(ROOT, '404.html');
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    let data = fs.readFileSync(file);
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (/text|javascript|json|xml|svg/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && req.method !== 'HEAD') {
      data = zlib.gzipSync(data);
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8787;
  await startServer(port);
  console.log(`Trusty da Horse (pretend API) on http://localhost:${port}`);
}
