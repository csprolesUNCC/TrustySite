// The clicks the site hands out for playing and watching, and the notes on the pages that say how many: Flappy's,
// Trustis's and Snake's (scripts/game-rewards.js), and Trusty TV's and Trusty Radio's (WATCH_REWARD in
// scripts/tv-schedule.js). The daily caps keep made-up scores and scripted watching small, so they stay small.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GAME_REWARDS, rewardFor, payable } from '../scripts/game-rewards.js';
import { WATCH_REWARD } from '../scripts/tv-schedule.js';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const fmt = (n) => n.toLocaleString('en-US');
const words = (html) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');

test('game rewards pay per point and stop at the daily cap', () => {
  for (const [game, rule] of Object.entries(GAME_REWARDS)) {
    assert.ok(rule.daily > 0 && rule.daily <= 1000, `${game}'s daily cap stays small (scores come from the browser)`);
    assert.equal(rewardFor(game, rule.per * 3), rule.clicks * 3);
    assert.equal(rewardFor(game, 0), 0);
    assert.equal(rewardFor(game, -5), 0);
    assert.equal(payable(game, 1e9, 0), rule.daily, 'a made-up score gets the cap, no more');
    assert.equal(payable(game, 1e9, rule.daily - 2), 2, 'the last game before the cap pays what’s left');
    assert.equal(payable(game, 1e9, rule.daily), 0);
  }
});

test('the game pages say what their games earn', () => {
  for (const [game, rule] of Object.entries(GAME_REWARDS)) {
    const html = words(read(`pages/games/${game}.html`));
    assert.ok(html.includes(`up to ${fmt(rule.daily)} clicks a day`), `pages/games/${game}.html says the cap is ${fmt(rule.daily)}`);
    assert.ok(html.includes(`${rule.clicks} clicks`), `pages/games/${game}.html says ${rule.clicks} clicks`);
  }
});

test('Trusty TV and Trusty Radio say what watching earns', () => {
  const { clicks, every, daily } = WATCH_REWARD;
  assert.ok(Number.isSafeInteger(daily / clicks), 'the cap is a whole number of rewards');
  for (const page of ['pages/tv.html', 'pages/radio.html']) {
    const html = words(read(page));
    assert.ok(html.includes(`very ${every} seconds you`), `${page} says every ${every} seconds`);
    assert.ok(html.includes(`earns you ${clicks} clicks`), `${page} says ${clicks} clicks`);
    assert.ok(html.includes(`up to ${fmt(daily)} a day`), `${page} says ${fmt(daily)} a day`);
  }
});
