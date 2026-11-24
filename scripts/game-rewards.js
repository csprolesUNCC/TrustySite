// Clicks for playing Flappy Trusty, Trustis and Trusty Snake. A logged-in player's finished game earns `clicks`
// for every `per` points it scored, up to `daily` clicks a day (from midnight Eastern) from each game. The scores
// come from the browser, so anyone could send a made-up one: the daily cap is what keeps that small.
// utils/game-rewards.js pays them (and tools/dev-server.mjs pretends to); the game pages' notes say the same numbers.
// Pure, so the pages, the API and the pretend API share it.

export const GAME_REWARDS = {
  flappy: { name: 'Flappy Trusty', per: 1, clicks: 2, daily: 500 },
  trustis: { name: 'Trustis', per: 10000, clicks: 100, daily: 500 },
  snake: { name: 'Trusty Snake', per: 1, clicks: 2, daily: 500 },
};

// What a game with this score earns, before the daily cap.
export function rewardFor(game, score) {
  const rule = GAME_REWARDS[game];
  if (!rule || !Number.isSafeInteger(score) || score <= 0) return 0;
  return Math.floor(score / rule.per) * rule.clicks;
}

// What's actually paid: the reward, cut down to what's left of today's cap. `today` is what this game has paid
// the account today so far.
export function payable(game, score, today = 0) {
  const rule = GAME_REWARDS[game];
  if (!rule) return 0;
  return Math.max(0, Math.min(rewardFor(game, score), rule.daily - today));
}
