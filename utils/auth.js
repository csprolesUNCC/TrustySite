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
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded; // Contains { userId, username }
    } catch (error) {
        return null;
    }
}

// The accounts that can use the admin panel (pages/admin.html, utils/moderation.js). Sign-up refuses a name
// that only differs from an existing one in capitals, so matching these case-insensitively can't let
// anyone else in, as long as both accounts exist.
const ADMINS = ['carson', 'luke'];

/**
 * @param {object|null} user - The payload from authenticateUser.
 * @returns {boolean} Whether that user is an admin.
 */
function isAdmin(user) {
    return Boolean(user && typeof user.username === 'string' && ADMINS.includes(user.username.toLowerCase()));
}

export { authenticateUser, isAdmin };