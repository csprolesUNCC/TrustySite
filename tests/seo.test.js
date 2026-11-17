// The search engine rules from CLAUDE.md ("Search engines"): every public page has a canonical address that's in
// sitemap.xml (and the other way round), link previews that point at that address, and a breadcrumb trail for
// Google; pages kept out of search have a noindex and stay out of the sitemap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://trustydahorse.com';

function htmlFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return rel === 'pages/games/embed' ? [] : htmlFiles(rel); // third-party files
    return entry.name.endsWith('.html') ? [rel] : [];
  });
}

const pages = ['index.html', '404.html', ...htmlFiles('pages')].map((file) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const attr = (re) => (re.exec(head) || [])[1];
  return {
    file,
    head,
    canonical: attr(/<link rel="canonical" href="([^"]+)">/),
    ogUrl: attr(/<meta property="og:url" content="([^"]+)">/),
    noindex: /<meta name="robots" content="noindex">/.test(head),
    jsonLd: [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])),
  };
});
const sitemap = [...fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const canonicalPages = pages.filter((p) => p.canonical);

test('sitemap.xml lists exactly the pages with a canonical address, and each one is that page', () => {
  assert.deepEqual([...sitemap].sort(), canonicalPages.map((p) => p.canonical).sort());
  for (const page of canonicalPages) {
    const expected = page.file === 'index.html' ? `${SITE}/` : `${SITE}/${page.file}`;
    assert.equal(page.canonical, expected, page.file);
  }
});

test('pages kept out of search have noindex, and no canonical address', () => {
  for (const page of pages.filter((p) => p.noindex)) {
    assert.equal(page.canonical, undefined, page.file);
  }
  for (const file of ['404.html', 'pages/admin.html', 'pages/auth/login.html', 'pages/auth/register.html']) {
    assert.ok(pages.find((p) => p.file === file).noindex, `${file} should have noindex`);
  }
});

test('public pages: a title, a description and link previews that point at the canonical address', () => {
  for (const page of canonicalPages) {
    assert.match(page.head, /<title>[^<]+<\/title>/, page.file);
    assert.match(page.head, /<meta name="description" content="[^"]{50,}">/, page.file);
    assert.equal(page.ogUrl, page.canonical, `${page.file}: og:url`);
    for (const tag of ['og:title', 'og:description', 'og:image']) {
      assert.match(page.head, new RegExp(`<meta property="${tag}" content="[^"]+">`), `${page.file}: ${tag}`);
    }
    assert.match(page.head, /<meta property="og:image" content="https:\/\/trustydahorse\.com\/[^"]+\.(png|jpe?g)">/, `${page.file}: og:image is a full PNG or JPEG address`);
    assert.match(page.head, /<meta name="twitter:card" content="summary_large_image">/, page.file);
  }
});

test('every public page but the home page has a breadcrumb trail from Home to itself, through public pages', () => {
  const listed = new Set(sitemap);
  for (const page of canonicalPages.filter((p) => p.file !== 'index.html')) {
    const trail = page.jsonLd.find((d) => d['@type'] === 'BreadcrumbList');
    assert.ok(trail, `${page.file} has no BreadcrumbList`);
    const items = trail.itemListElement;
    assert.ok(items.length >= 2, page.file);
    items.forEach((item, i) => {
      assert.equal(item['@type'], 'ListItem', page.file);
      assert.equal(item.position, i + 1, page.file);
      assert.ok(typeof item.name === 'string' && item.name.trim(), page.file);
      assert.ok(listed.has(item.item), `${page.file}: ${item.item} isn't a page in the sitemap`);
    });
    assert.equal(items[0].item, `${SITE}/`, page.file);
    assert.equal(items.at(-1).item, page.canonical, page.file);
  }
});

test('every page has a favicon Google can use (a multiple of 48px)', () => {
  for (const page of pages) {
    assert.match(page.head, /<link rel="icon" type="image\/png" sizes="96x96" href="\/images\/icons\/icon-96x96\.png">/, page.file);
  }
});
