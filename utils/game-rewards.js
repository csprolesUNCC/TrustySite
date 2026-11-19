import { connectToDatabase } from './db.js';
import { GAME_REWARDS, payable } from '../scripts/game-rewards.js';
import { dayOf } from '../scripts/milestones.js';

// Pays the clicks for a finished Flappy Trusty, Trustis or Trusty Snake game (rules in scripts/game-rewards.js),
// called by each game's score POST once it has checked the score. What each game has paid today is counted in
// `gameDaily.<game>` ({ day, clicks }) on the account's `click_game` document, and the update only goes in if
// that count is still what was read, so two tabs or a retried request can't go past the cap.
// Returns { added, clicks, today, cap }; `added` is 0 when there's nothing to pay or today's cap is reached.

const TRIES = 3;

export async function payGame(user, game, score) {
    const rule = GAME_REWARDS[game];
    const cap = rule.daily;
    const today = dayOf(new Date());
    const field = `gameDaily.${game}`;
    const collection = (await connectToDatabase()).collection('click_game');

    for (let tries = 0; tries < TRIES; tries++) {
        const doc = await collection.findOne({ userId: user.userId }, { projection: { clicks: 1, [field]: 1 } });
        const counted = doc && doc.gameDaily && doc.gameDaily[game];
        const sofar = counted && counted.day === today ? counted.clicks : 0;
        const added = payable(game, score, sofar);
        if (!added) return { added: 0, clicks: doc ? doc.clicks : 0, today: sofar, cap };

        if (!doc) {
            // Their first clicks ever.
            const inserted = await collection.updateOne(
                { userId: user.userId },
                { $setOnInsert: { clicks: added, username: user.username, recent: [], gameDaily: { [game]: { day: today, clicks: added } } } },
                { upsert: true }
            );
            if (inserted.upsertedCount) return { added, clicks: added, today: added, cap };
            continue;
        }

        const unchanged = counted
            ? { [`${field}.day`]: counted.day, [`${field}.clicks`]: counted.clicks }
            : { [field]: { $exists: false } };
        const result = await collection.findOneAndUpdate(
            { userId: user.userId, ...unchanged },
            { $inc: { clicks: added }, $set: { username: user.username, [field]: { day: today, clicks: sofar + added } } },
            { returnDocument: 'after', projection: { clicks: 1 } }
        );
        const paid = result && 'value' in result ? result.value : result;
        if (paid) return { added, clicks: paid.clicks, today: sofar + added, cap };
        // Another request paid this game in between: read it again.
    }
    return { added: 0, today: null, cap };
}

// For the score endpoints: the reward, or null if paying it failed (the score is saved either way).
export async function rewardGame(user, game, score) {
    try {
        return await payGame(user, game, score);
    } catch (error) {
        console.error(`${GAME_REWARDS[game].name} reward error:`, error);
        return null;
    }
}
