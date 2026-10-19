import { ObjectId } from 'mongodb';
import { connectToDatabase } from './db.js';
import connectToUsersDatabase from './connect.js';
import { authenticateUser, isAdmin, setAuthCookie } from './auth.js';
import { usernameProblem, RENAME_DAYS } from '../scripts/username.js';

// Changing your username (the Change username button on your own profile, pages/profile.html), served from
// api/leaderboard.js as ?action=rename so it doesn't take up another Vercel function.
//   POST { username }: renames the logged-in account, at most once every RENAME_DAYS days. Answers
//     { username, nextRename } and sets a login cookie with the new name.
// The new name has to follow the sign-up rules (scripts/username.js) and can't be anyone else's, capitals
// aside. ADMINS (utils/auth.js) go by name, so admin accounts can't be renamed and nobody can take an admin's
// name. The account keeps its old names in `pastUsernames`.
// The game collections keep a copy of each player's name (NAME_COPIES) for the boards, so a rename copies the
// new name into them. Login tokens carry the name too: GET /api/auth/login notices a token with an old one
// (from before a rename on another device), copies the name again and swaps the token.

const RENAME_MS = RENAME_DAYS * 24 * 60 * 60 * 1000;
const CASE_INSENSITIVE = { locale: 'en', strength: 2 }; // the same collation register.js checks names with

// The collections in the game db that keep a copy of the player's name, and the field it's in.
const NAME_COPIES = [
    ['click_game', 'username'],
    ['scores', 'name'], // Flappy Trusty
    ['draw_scores', 'name'],
    ['trustis_scores', 'name'],
    ['trustle', 'username'],
    ['profiles', 'username'],
];

/**
 * Puts the account's name into every game collection that keeps a copy of it.
 * @param {string} userId
 * @param {string} username
 */
export async function copyName(userId, username) {
    const db = await connectToDatabase();
    await Promise.all(NAME_COPIES.map(([collection, field]) =>
        db.collection(collection).updateMany({ userId: String(userId) }, { $set: { [field]: username } })));
}

/**
 * @param {object} account - The account from the users db, with `usernameChangedAt`.
 * @returns {Date|null} When it can change its username again, or null if it can now.
 */
export function nextRename(account) {
    const last = account && account.usernameChangedAt;
    if (!(last instanceof Date)) return null;
    const next = new Date(last.getTime() + RENAME_MS);
    return next > new Date() ? next : null;
}

/**
 * @param {object} user - The payload from authenticateUser.
 * @returns {Promise<string>} The account's username now, which isn't the token's if it was renamed since the
 * token was made. The token's when the account can't be looked up.
 */
export async function currentUsername(user) {
    try {
        const { db } = await connectToUsersDatabase();
        const account = await db.collection('users').findOne(
            { _id: new ObjectId(String(user.userId)) },
            { projection: { username: 1 } }
        );
        return account && typeof account.username === 'string' ? account.username : user.username;
    } catch (error) {
        console.error('Username lookup failed:', error);
        return user.username;
    }
}

export default async function rename(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
    const user = authenticateUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (isAdmin(user)) return res.status(403).json({ error: 'Admin accounts keep their username: the admin panel goes by it.' });

    const sent = req.body && req.body.username;
    const username = typeof sent === 'string' ? sent.trim() : '';
    const problem = usernameProblem(username);
    if (problem) return res.status(400).json({ error: problem });

    try {
        const { db } = await connectToUsersDatabase();
        const accounts = db.collection('users');
        const _id = new ObjectId(String(user.userId));
        const account = await accounts.findOne({ _id }, { projection: { username: 1, usernameChangedAt: 1 } });
        if (!account) return res.status(401).json({ error: 'Authentication required' });
        if (account.username === username) return res.status(400).json({ error: 'That’s already your username.' });
        const next = nextRename(account);
        if (next) {
            return res.status(429).json({ error: `You can only change your username once every ${RENAME_DAYS} days.`, nextRename: next });
        }

        const taken = isAdmin({ username }) || await accounts.findOne(
            { username, _id: { $ne: _id } },
            { collation: CASE_INSENSITIVE, projection: { _id: 1 } }
        );
        if (taken) return res.status(409).json({ error: 'That username is taken.' });

        // Only if it hasn't been renamed since it was read, so two renames at once can't both go through.
        const now = new Date();
        const renamed = await accounts.updateOne(
            { _id, usernameChangedAt: { $not: { $gt: new Date(now.getTime() - RENAME_MS) } } },
            {
                $set: { username, usernameChangedAt: now },
                $push: { pastUsernames: { username: account.username, until: now } },
            }
        );
        if (!renamed.matchedCount) return res.status(409).json({ error: 'Your username just changed. Reload the page to see it.' });
        console.log(`Rename: ${account.username} is now ${username}`);

        // The new login cookie has the new name. If the copying didn't go through, the old cookie stays, so the
        // next page load (GET /api/auth/login) sees the old name and copies the new one again.
        try {
            await copyName(user.userId, username);
            setAuthCookie(res, { userId: user.userId, username });
        } catch (error) {
            console.error('Rename: copying the new name failed:', error);
        }
        return res.status(200).json({ username, nextRename: new Date(now.getTime() + RENAME_MS) });
    } catch (error) {
        console.error('Rename API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
