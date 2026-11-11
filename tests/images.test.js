// The rules for images/ from CLAUDE.md: every picture lives in a folder, every one the site names is there, and
// the old addresses vercel.json redirects (link previews from before the folders) lead to one that is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const exists = (path) => fs.existsSync(new URL(path.replace(/^\//, ''), root));

// Our own code in a folder (pages/games/embed/ is third-party and left alone).
function files(dir) {
  return fs.readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return path === 'pages/games/embed' ? [] : files(`${path}/`);
    return /\.(html|css|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

test('every image the site names exists', () => {
  const site = [
    ...fs.readdirSync(root).filter((name) => name.endsWith('.html')),
    ...files('pages/'), ...files('scripts/'), ...files('styles/'), ...files('api/'), ...files('utils/'),
  ];
  let found = 0;
  for (const file of site) {
    const text = fs.readFileSync(new URL(file, root), 'utf8');
    // Each path, with the site in front of it if it has one (link previews name the full address); other sites'
    // /images/ aren't ours. A path built in code stops at its first ${...}, so the comic reader's is checked as
    // far as /images/comics/.
    for (const [, host, path] of text.matchAll(/(?:https?:\/\/([\w.-]+))?(\/[\w./-]*)/g)) {
      if (!path.startsWith('/images/') || (host && host !== 'trustydahorse.com')) continue;
      const image = path.replace(/\.+$/, '');
      assert.ok(exists(image), `${file} names ${image}, which isn't there`);
      found++;
    }
  }
  assert.ok(found > 0, 'found no images at all');
});

test('images/ keeps every picture in a folder', () => {
  const loose = fs.readdirSync(new URL('images/', root), { withFileTypes: true })
    .filter((entry) => !entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
  assert.deepEqual(loose, [], `put these in a folder in images/: ${loose.join(', ')}`);
});

test('old image addresses in vercel.json redirect to images that exist', () => {
  const { redirects = [] } = JSON.parse(fs.readFileSync(new URL('vercel.json', root), 'utf8'));
  for (const { source, destination } of redirects.filter((r) => /^\/images\/[\w./-]+$/.test(r.source))) {
    assert.ok(exists(destination), `${source} redirects to ${destination}, which isn't there`);
    assert.ok(!exists(source), `${source} is back, but the redirect hides it`);
  }
});
