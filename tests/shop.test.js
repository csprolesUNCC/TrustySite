// The Item Shop's catalog and rules (scripts/shop.js), from CLAUDE.md's "Item Shop".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, ITEMS, DEFAULTS, TIERS, itemById, itemsOf, tierOf, equippedOf, nameStyleOf, cleanStyle, cleanOrder, fraktur } from '../scripts/shop.js';
import { limitBasis } from '../utils/bank-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every item has a unique id, a known kind and a whole-number price', () => {
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  for (const item of ITEMS) {
    assert.ok(KINDS.includes(item.kind), item.id);
    assert.ok(Number.isSafeInteger(item.price) && item.price >= 0, item.id);
    assert.ok(item.name && item.about, item.id);
    assert.ok(tierOf(item.price), item.id);
  }
});

test('each kind has exactly one free item, its default, and something in every paid tier but the top for themes', () => {
  for (const kind of KINDS) {
    const free = itemsOf(kind).filter((i) => i.price === 0);
    assert.deepEqual(free.map((i) => i.id), [DEFAULTS[kind]], kind);
    const tiers = new Set(itemsOf(kind).map((i) => tierOf(i.price).key));
    for (const key of ['starter', 'common', 'rare', 'epic', 'legendary']) assert.ok(tiers.has(key), `${kind} has a ${key} item`);
  }
  assert.equal(TIERS.at(-1).at, 0);
});

test('every theme has a stylesheet rule and a swatch, and the dark ones are the ones the stylesheet treats as dark', () => {
  const css = fs.readFileSync(path.join(root, 'styles/stylesheet.css'), 'utf8');
  const darkList = /:root:is\(([^)]*)\) \.ink \{/.exec(css)[1];
  for (const theme of itemsOf('theme')) {
    assert.equal(theme.swatch.length, 2, theme.id);
    if (theme.id === DEFAULTS.theme) continue;
    assert.ok(css.includes(`:root[data-site-theme="${theme.id}"]`), `${theme.id} has no rule`);
    assert.equal(darkList.includes(`"${theme.id}"`), Boolean(theme.dark), `${theme.id} dark`);
  }
});

test('every name item has a stylesheet rule', () => {
  const css = fs.readFileSync(path.join(root, 'styles/stylesheet.css'), 'utf8');
  for (const kind of ['font', 'color', 'highlight']) {
    for (const item of itemsOf(kind)) {
      if (item.id === DEFAULTS[kind]) continue;
      assert.ok(css.includes(`[data-${kind}="${item.id}"]`) || (item.id.startsWith('pastel-') && css.includes(`[data-${kind}^="pastel-"]`)), `${item.id} has no rule`);
    }
  }
});

test('only owned items count as equipped, and the public style leaves out themes and defaults', () => {
  assert.deepEqual(equippedOf(null), DEFAULTS);
  const shop = { owned: ['chalkboard', 'red', 'bogus'], equipped: { theme: 'chalkboard', color: 'red', font: 'quill', highlight: 'none' } };
  assert.deepEqual(equippedOf(shop), { ...DEFAULTS, theme: 'chalkboard', color: 'red' });
  assert.deepEqual(nameStyleOf(shop), { color: 'red' });
  assert.equal(nameStyleOf({ owned: ['neon'], equipped: { theme: 'neon' } }), null);
  assert.deepEqual(cleanStyle({ font: 'red', color: 'red', highlight: 'sparkle', theme: 'neon' }), { color: 'red', highlight: 'sparkle' });
});

test('orders: free items can be put on but not bought, and anything else is refused', () => {
  assert.equal(cleanOrder({ do: 'buy', id: 'notebook' }), null);
  assert.equal(cleanOrder({ do: 'buy', id: { $ne: null } }), null);
  assert.equal(cleanOrder({ do: 'sell', id: 'neon' }), null);
  assert.equal(cleanOrder({ do: 'equip', id: 'notebook' }).item, itemById('notebook'));
  assert.equal(cleanOrder({ do: 'buy', id: 'neon' }).item.price, 150000);
});

test('blackletter only swaps A–Z and a–z', () => {
  assert.equal(fraktur('Ty_9'), `${String.fromCodePoint(0x1D57F, 0x1D59E)}_9`); // bold Fraktur T and y
});

test('what was spent in the shop today doesn’t lower the day’s betting limit', () => {
  assert.equal(limitBasis(27000, 0, 25000), 52000);
  assert.equal(limitBasis(6000, 1500), 4500);
});
