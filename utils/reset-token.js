import crypto from 'crypto';

// Password reset tokens (api/auth/request-reset.js hands one out by email, api/auth/reset-password.js takes
// it back). The database only keeps a hash of each one, so a copy of the database can't be used to reset
// anyone's password.

// What a token looks like: 32 random bytes as hex.
export const RESET_TOKEN = /^[0-9a-f]{64}$/;

export function newResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

export function hashResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
