// utils/auth.js
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
}

// Helper to extract the token from cookies
function getAuthToken(req) {
    const cookies = req.headers.cookie;
    if (!cookies) return null;
    
    const parts = cookies.split(';');
    for (const part of parts) {
        const [name, value] = part.trim().split('=');
        if (name === 'authToken') {
            return value;
        }
    }
    return null;
}

/**
 * Authenticates the user based on the authToken cookie.
 * @param {object} req - The Vercel request object.
 * @returns {object|null} The decoded token payload (userId, username) or null if unauthenticated.
 */
function authenticateUser(req) {
    const token = getAuthToken(req);
    if (!token) return null;

    try {
        // Only the algorithm setAuthCookie signs with, so a token can't pick a weaker one for itself.
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        return decoded; // Contains { userId, username }
    } catch (error) {
        return null;
    }
}

// Logins last 30 days and renew on use: GET /api/auth/login (called on every page load while logged in)
// hands out a fresh token once the current one is a day old, so only a month away logs you out.
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const RENEW_AFTER_SECONDS = 60 * 60 * 24;

/**
 * Signs a login token for the user and sets it as the authToken cookie.
 * @param {object} res - The Vercel response object.
 * @param {{ userId: *, username: string }} user
 */
function setAuthCookie(res, { userId, username }) {
    const token = jwt.sign({ userId, username }, JWT_SECRET, { algorithm: 'HS256', expiresIn: SESSION_SECONDS });
    res.setHeader('Set-Cookie', `authToken=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`);
}

/** Logs this browser out: the authToken cookie, emptied and already expired. */
function clearAuthCookie(res) {
    res.setHeader('Set-Cookie', 'authToken=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
}

/**
 * Resetting a password (api/auth/reset-password.js) logs out every device that was logged in before it, so a
 * stolen login stops working once its owner resets their password. Tokens carry when they were made (`iat`, in
 * seconds) and the account when its password last changed (`passwordChangedAt`).
 * @param {object} user - The payload from authenticateUser.
 * @param {object|null} account - The account from the users db, with `passwordChangedAt`.
 * @returns {boolean} Whether that token was made before the password changed, so it no longer counts.
 */
function tokenRevoked(user, account) {
    const changed = account && account.passwordChangedAt instanceof Date ? account.passwordChangedAt.getTime() : NaN;
    if (!Number.isFinite(changed)) return false;
    // Seconds, like `iat`: a login in the same second as the reset is the new password's.
    return !(typeof user.iat === 'number' && user.iat >= Math.floor(changed / 1000));
}

/**
 * @param {object} user - The payload from authenticateUser.
 * @returns {boolean} Whether its token is old enough to swap for a fresh one. Goes by the time left,
 * so shorter tokens (the old 1-day ones) are renewed straight away.
 */
function shouldRenew(user) {
    if (typeof user.exp !== 'number') return true;
    return user.exp - Date.now() / 1000 < SESSION_SECONDS - RENEW_AFTER_SECONDS;
}

// The accounts that can use the admin panel (pages/admin.html, utils/moderation.js). Sign-up refuses a name
// that only differs from an existing one in capitals, so matching these case-insensitively can't let
// anyone else in, as long as both accounts exist. Changing your username (utils/rename.js) refuses these
// names, and admin accounts can't change theirs, since that would hand the name to whoever took it next.
const ADMINS = ['carson', 'luke'];

/**
 * @param {object|null} user - The payload from authenticateUser.
 * @returns {boolean} Whether that user is an admin.
 */
function isAdmin(user) {
    return Boolean(user && typeof user.username === 'string' && ADMINS.includes(user.username.toLowerCase()));
}

export { authenticateUser, isAdmin, setAuthCookie, clearAuthCookie, shouldRenew, tokenRevoked };