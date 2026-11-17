// Answers that are the same for everyone (the leaderboards) are kept by Vercel's CDN for a few seconds, so most
// visitors get them from the CDN instead of from a function and the database. Browsers still ask every time (and
// the CDN answers them). `?fresh=1` skips the CDN: a game page asks that way right after it saves a score, so the
// player sees their own new score on the board straight away (fetchBoard() in scripts/leaderboard.js).
export const BOARD_SECONDS = 15;

export function cachePublic(req, res, seconds = BOARD_SECONDS) {
  if (req.query && req.query.fresh) {
    res.setHeader('Cache-Control', 'no-store');
    return;
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Vercel-CDN-Cache-Control', `max-age=${seconds}`);
}
