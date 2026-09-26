# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Fan site for "Trusty da Horse", a stick-figure horse drawn on notebook paper: static HTML pages (comics, browser games, an AI chat, a 3D viewer) plus Vercel serverless functions backed by MongoDB. There is no build step, bundler, framework, linter, or test suite — `npm test` is a placeholder that fails.

## Running locally

- Deployed on Vercel; `vercel.json` only sets `outputDirectory: "."`, so the repo root is served as-is and every file in `api/` becomes a function at `/api/<path>` (e.g. `api/auth/login.js` → `/api/auth/login`). `404.html` at the root is Vercel's not-found page.
- Full stack: `vercel dev` (needs `.env` with `MONGODB_URI`, `USERS_MONGODB_URI`, `JWT_SECRET`, `GEMINI_API_KEY`, `RESEND_API_KEY`). Frontend only: any static server at the repo root (e.g. `npx serve .`); API-backed features (login, leaderboards, clicker, TrustyGPT) won't work.
- Pages must be served from the root — all asset, script and API paths are root-absolute (`/styles/...`, `/scripts/...`, `/api/...`).

## Frontend architecture

- **Design system:** `styles/stylesheet.css` holds tokens (paper/ink palette, Permanent Marker + Caveat fonts loaded from Google Fonts in each page head) and shared components: `.sheet` (ruled notebook paper), `.card`/`.card-link` (index cards with a stretched title link), `.sticky-note`, `.btn` variants, `.panel`, `.tabs`, `.board` (leaderboard rows), forms, dialogs. `.ink` makes black-on-white line art blend into the paper (`mix-blend-mode: multiply`). `styles/games.css` adds the game shell (`.stage` fixed-aspect play area with `--ar`/`--stage-room`, overlays, focus mode, touch pads) and is only linked from game pages.
- **Shared chrome:** every page loads `scripts/site.js` (ES module) and uses `<trusty-header>` / `<trusty-footer>` custom elements, which render the nav, account area, mobile menu and the header "clicker" (`/api/clicks`). The nav list lives in `NAV` in `site.js`.
- **Session:** client login state is the `localStorage` keys `isUserLoggedIn` / `username` (the same keys the site has always used). `site.js` only calls `GET /api/auth/login` when the flag is set, clears it on 401, and exposes `session`, `sessionReady`, `onSession`, `logout`, `loginHref` (adds a `?next=` return path). `html[data-auth="in"|"out"]` plus `data-auth-show="in|out"` toggles logged-in/out content in markup.
- **Rendering user data:** build DOM with `h()` from `site.js` (never `innerHTML` with API data). Leaderboard names and drawings come from other users; `scripts/leaderboard.js` renders all three boards and only accepts drawings that are PNG data URLs.
- **Modules:** `scripts/leaderboard.js` (fetch/render clicks, Flappy, Draw boards + drawing viewer), `scripts/comics.js` (season pages list episodes as cards with `data-episode`/`data-pages`; this turns them into a `<dialog>` reader with `#ep-N` deep links), `scripts/auth.js` (login/register/forgot/reset forms), `scripts/draw-reference.js` (Trusty's reference pose — Draw Trusty grading depends on it), `scripts/game-kit.js` (sprites, ink conversion, sound with a site-wide mute, focus mode, swipe input, local best scores).
- **Adding a comic episode:** drop pages at `images/comics/<comic>/<season>/e<N>/p<M>.jpg` and add an `<article ... data-episode="N" data-pages="M">` card to that season page.
- **Latest Update box:** plain HTML in `index.html` (`.hero-note`); edit it directly.

## Games

- Flappy, Draw, Snake, Trustis and Blackjack are self-contained in `pages/games/*.html` (inline module scripts). Flappy's physics (800×600 world, gravity, pipe gap/speed/spawn, hitbox) is intentionally identical to the original so leaderboard scores stay comparable — don't tweak it casually. Those constants are per 60 Hz frame, so the simulation runs in fixed 60 steps/second (drawing interpolates between steps) to play the same on 120/144 Hz screens. A pencil scores when Trusty's middle passes its middle (as in Flappy Bird); resting on the floor is safe by design.
- **Draw Trusty grading** lives in `scripts/draw-grader.js` (pure JS, no DOM) and grades against the shapes in `scripts/draw-reference.js`. The browser grades for instant feedback, and `api/draw-api.js` re-grades the submitted PNG (decoded by `utils/png.js`) with the same module and stores its own score, so client-sent scores are ignored. Scores are tagged with `GRADER_VERSION`; leaderboard and personal-best queries only count the current version. If you change grading behavior, bump `GRADER_VERSION` so old and new scores don't mix.
- **Trustis** follows the standard Tetris Guideline: 10×20 field with hidden rows above, 7-bag, SRS rotation and wall kicks, hold, 5-piece next queue, guideline gravity/scoring (T-Spins, back-to-back, combos, perfect clears) and 0.5s lock delay with 15 move resets. The blocks come from `images/sprites.png`; `ART` in the page records which rotation state each drawing was made in (L and J art is vertical), and every cell's sprite turns with the piece so the drawing stays whole.
- Arcade games (`driving`, `crazycattle`, `gta`, `football`) wrap iframes behind a click-to-load cover. `pages/games/embed/*` are third-party embed files and are left untouched.

## Backend: `api/` serverless functions (ES modules)

- Each file default-exports `async (req, res)` and branches on `req.method`; some multiplex via `?action=` (`flappy-api.js`: `action=personal`; `draw-api.js`: `get_leaderboard` / `submit` / `get_personal`).
- **Two separate MongoDB connection helpers — pick the right one:**
  - `api/db.js` → named export `connectToDatabase()`, uses `MONGODB_URI`, returns the `flappy_scores` db directly. Used for game data (scores, clicks, drawings, leaderboard).
  - `api/connect.js` → default export, uses `USERS_MONGODB_URI`, returns `{ client, db }` for the `trusty-users` db. Used by `api/auth/*`.
- Auth: `api/auth/login.js` issues a JWT (`{ userId, username }`, 1 day) in an HttpOnly `authToken` cookie. Protected endpoints call `authenticateUser(req)` from `utils/auth.js`, which returns the decoded payload or `null`.
- Password reset emails go through Resend (`api/auth/request-reset.js`) and link to `/pages/auth/reset-password.html?token=…` — keep that path stable. `api/gemini.js` proxies TrustyGPT to Gemini with a fixed persona prompt.
