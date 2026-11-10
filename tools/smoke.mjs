// Loads every page in a real browser against tools/dev-server.mjs, at phone and desktop widths, logged out
// and logged in, and fails if any page throws, logs an error, requests a missing file, scrolls sideways, has a
// broken image or link, or has an accessibility problem axe-core can find. Then two people play Trusty Fever online
// (the dev server runs the rooms) and every online overlay gets the same checks.
//   npm run smoke   (needs Playwright: preinstalled in Claude Code cloud sessions, otherwise `npx playwright install chromium`
//                    and `npm i -D playwright`)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { startServer } from './dev-server.mjs';

const require = createRequire(import.meta.url);
function load(name, fallback) {
  try { return require(name); } catch { return fallback ? require(fallback) : null; }
}
const playwright = load('playwright', '/opt/node22/lib/node_modules/playwright');
const axePath = (() => { try { return require.resolve('axe-core/axe.min.js'); } catch { return null; } })();

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
const sitemapPages = [...fs.readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8').matchAll(/<loc>https:\/\/trustydahorse\.com([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
const PAGES = [
  ...sitemapPages,
  '/a-page-that-does-not-exist', '/pages/admin.html', '/pages/auth/login.html', '/pages/auth/register.html',
  '/pages/auth/forgot-password.html', '/pages/auth/reset-password.html?token=abc', '/pages/profile.html?u=carson', '/pages/profile.html',
];
// Third parties the pages embed (and that may be unreachable from wherever this runs).
const THIRD_PARTY = /youtube|ytimg|googlevideo|open-meteo|bigdatacloud|ajax\.googleapis|gstatic|onlinegames|retrogames|itch\.io|doubleclick/;

const server = await startServer(PORT);
const browser = await playwright.chromium.launch();
const problems = [];
const links = new Set();

async function axeProblems(page) {
  if (!axePath) return [];
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .filter((v) => v.id !== 'region')
    .map((v) => `a11y (${v.impact}) ${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`));
}

for (const auth of ['out', 'in']) {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    if (auth === 'in') {
      await context.addCookies([{ name: 'mock', value: 'in', url: BASE }]);
      await context.addInitScript(() => { try { localStorage.setItem('isUserLoggedIn', 'true'); localStorage.setItem('username', 'carson'); } catch { /* */ } });
    }
    for (const path of PAGES) {
      const page = await context.newPage();
      const found = [];
      page.on('pageerror', (e) => found.push(`threw: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error' && m.type() !== 'warning') return;
        // Only our own code's messages: embeds (YouTube, the arcade games) log plenty of their own.
        const from = m.location().url;
        if (from && !from.startsWith(BASE)) return;
        const text = m.text();
        if (THIRD_PARTY.test(text) || /Failed to load resource|ERR_|GL Driver|WebGL/.test(text)) return;
        found.push(`console.${m.type()}: ${text.slice(0, 200)}`);
      });
      page.on('response', (r) => {
        const url = r.url();
        if (r.status() < 400 || !url.startsWith(BASE) || url.includes('/api/')) return;
        if (path === '/a-page-that-does-not-exist' && url === BASE + path) return;
        found.push(`HTTP ${r.status()}: ${url.replace(BASE, '')}`);
      });
      try {
        await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 });
      } catch (e) {
        found.push(`didn't load: ${e.message.split('\n')[0]}`);
      }
      await page.waitForTimeout(400);
      const checks = await page.evaluate(() => {
        const out = [];
        const w = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > w + 1) out.push(`scrolls sideways (${document.documentElement.scrollWidth}px wide in ${w}px)`);
        for (const img of document.images) {
          if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) out.push(`broken image: ${img.getAttribute('src')}`);
        }
        return out;
      });
      found.push(...checks);
      found.push(...await axeProblems(page));
      const here = page.url().split('#')[0];
      for (const href of await page.$$eval('a[href]', (as) => as.map((a) => a.href))) {
        const target = href.split('#')[0];
        if (href.startsWith(BASE) && target !== here) links.add(target); // skip links to the page itself (#main)
      }
      if (found.length) problems.push(`${path} (logged ${auth}, ${width}px)\n    ${[...new Set(found)].join('\n    ')}`);
      await page.close();
    }
    await context.close();
  }
}

// Trusty Fever online: carson makes a room, luke joins with the link, and they play for a few seconds.
{
  const found = [];
  const people = [];
  for (const name of ['carson', 'luke']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addCookies([{ name: 'mock', value: 'in', url: BASE }, { name: 'mockuser', value: name, url: BASE }]);
    await context.addInitScript((n) => { try { localStorage.setItem('isUserLoggedIn', 'true'); localStorage.setItem('username', n); } catch { /* */ } }, name);
    const page = await context.newPage();
    page.on('pageerror', (e) => found.push(`${name}'s page threw: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') found.push(`${name}'s console.${m.type()}: ${m.text().slice(0, 200)}`); });
    people.push({ context, page });
  }
  const [host, guest] = people.map((p) => p.page);
  const check = async (page, what) => found.push(...(await axeProblems(page)).map((v) => `${what}: ${v}`));
  const scores = (page) => page.$eval('#scores', (el) => el.innerText);
  try {
    await host.goto(`${BASE}/pages/games/fever.html`, { waitUntil: 'networkidle' });
    await host.click('#online-btn');
    await check(host, 'make or join');
    await host.click('#make-btn');
    await host.waitForFunction(() => document.querySelector('#room-sub').textContent.includes('Nobody'), null, { timeout: 5000 });
    const code = await host.$eval('#room-code', (el) => el.textContent);
    await guest.goto(`${BASE}/pages/games/fever.html#room=${code}`, { waitUntil: 'networkidle' });
    await host.waitForFunction(() => document.querySelector('#room-sub').textContent.includes('luke'), null, { timeout: 5000 });
    await check(host, 'room, host');
    await check(guest, 'room, guest');
    await host.click('#room-start');
    for (const page of [host, guest]) await page.waitForFunction(() => document.querySelector('#overlay-room').hidden, null, { timeout: 5000 });
    await host.keyboard.down('ArrowLeft');
    await host.waitForTimeout(3500);
    await host.keyboard.up('ArrowLeft');
    if (!(await scores(guest)).includes('carson')) found.push('luke doesn’t see carson in the game');
    if ((await scores(host)).replace(/you|online/g, '') !== (await scores(guest)).replace(/you|online/g, '')) found.push('the two pages show different scores');
    await host.keyboard.press('Escape');
    await check(host, 'online menu');
  } catch (e) {
    found.push(`didn't get through a game: ${e.message.split('\n')[0]}`);
  }
  for (const p of people) await p.context.close();
  if (found.length) problems.push(`Trusty Fever online\n    ${[...new Set(found)].join('\n    ')}`);
}

for (const href of links) {
  const res = await fetch(href);
  if (res.status >= 400) problems.push(`broken link: ${href.replace(BASE, '')} (${res.status})`);
}

await browser.close();
server.close();
console.log(`${PAGES.length} pages x 4 (phone/desktop, logged out/in), ${links.size} links, an online Trusty Fever game${axePath ? '' : ' (axe-core not installed: no accessibility checks)'}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n\n${problems.join('\n\n')}`);
  process.exit(1);
}
console.log('All clear.');
