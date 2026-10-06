// utils/auth.js
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
}

// Admins (pages/admin.html) are the accounts named in ADMIN_USERNAMES, comma-separated, in any case.
// Only list names that are already registered: anyone could sign up as a free one and be an admin.
const ADMIN_USERNAMES = new Set(
    (process.env.ADMIN_USERNAMES || '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean)
);

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
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded; // Contains { userId, username }
    } catch (error) {
        return null;
    }
}

/**
 * Whether a user from authenticateUser() is an admin. Admin APIs check this on every request.
 * @param {object|null} user - The decoded token payload, or null.
 * @returns {boolean}
 */
function isAdmin(user) {
    return Boolean(user && typeof user.username === 'string' && ADMIN_USERNAMES.has(user.username.toLowerCase()));
}

export { authenticateUser, isAdmin };