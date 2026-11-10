import bcrypt from 'bcryptjs';
import connectToDatabase from '../../utils/connect.js';
import { authenticateUser, isAdmin, setAuthCookie, shouldRenew } from '../../utils/auth.js';
import { copyName, currentUsername } from '../../utils/rename.js';
import { countHit, overLimit, clientIp } from '../../utils/rate-limit.js';

// Wrong passwords allowed per FAIL_WINDOW_MS (utils/rate-limit.js): from one IP address, and for one account from
// one IP address. The account count goes by IP too, so nobody can lock someone else out by typing wrong passwords
// at their username.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAILS_PER_IP = 20;
const FAILS_PER_ACCOUNT = 10;
const TOO_MANY = { message: 'Too many tries. Wait 15 minutes and try again.' };

export default async (req, res) => {

    if (req.method === 'GET') {
        const user = authenticateUser(req);

        if (user) {
            // A token from before a rename (made on another device, see utils/rename.js) still has the old name,
            // and anything saved with it since then went out under that name. Copy the new one again and swap
            // the token; if the copying fails, keep the old token so the next page load tries again.
            const username = await currentUsername(user);
            if (username !== user.username) {
                try {
                    await copyName(user.userId, username);
                    setAuthCookie(res, { userId: user.userId, username });
                } catch (error) {
                    console.error('Login API Error: copying a changed username failed:', error);
                }
            } else if (shouldRenew(user)) {
                setAuthCookie(res, user);
            }
            // isAdmin only decides whether the page shows the Admin button; admin requests check it again.
            return res.status(200).json({
                isLoggedIn: true,
                username,
                isAdmin: isAdmin({ username })
            });
        } else {
            return res.status(401).json({ 
                isLoggedIn: false, 
                message: 'Session expired' 
            });
        }
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // Accept either an email or a username. The form field may still be
        // named "email", so fall back to that for backwards compatibility.
        const sent = req.body?.identifier ?? req.body?.email;
        const identifier = typeof sent === 'string' ? sent.trim() : '';
        const password = req.body?.password;

        // Only plain strings go into the lookup (an object there would be a query of its own).
        if (!identifier || typeof password !== 'string' || !password) {
            return res.status(400).json({ message: 'Missing required fields.' });
        }

        const ip = clientIp(req);
        const ipKey = `login-ip:${ip}`;
        const accountKey = `login-account:${ip}:${identifier.toLowerCase()}`;
        const [ipBlocked, accountBlocked] = await Promise.all([
            overLimit(ipKey, FAILS_PER_IP, FAIL_WINDOW_MS),
            overLimit(accountKey, FAILS_PER_ACCOUNT, FAIL_WINDOW_MS),
        ]);
        if (ipBlocked || accountBlocked) return res.status(429).json(TOO_MANY);

        const { db } = await connectToDatabase();
        const failed = async () => {
            await Promise.all([countHit(ipKey, FAIL_WINDOW_MS), countHit(accountKey, FAIL_WINDOW_MS)]);
            return res.status(401).json({ message: 'Invalid credentials.' });
        };

        const usersCollection = db.collection('users');

        // If it contains "@" treat it as an email, otherwise as a username.
        // This keeps the lookup unambiguous (usernames must not contain "@").
        const query = identifier.includes('@')
            ? { email: identifier.toLowerCase() }
            : { username: identifier };

        // Collation makes the match case-insensitive, including old mixed-case emails.
        const user = await usersCollection.findOne(query, {
            collation: { locale: 'en', strength: 2 }
        });
        if (!user) return await failed();

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return await failed();

        const tokenPayload = { 
            userId: user._id, 
            username: user.username 
        };

        setAuthCookie(res, tokenPayload);
        res.status(200).json({ message: 'Login successful', username: user.username, isAdmin: isAdmin(tokenPayload) });

    } catch (error) {
        console.error('Login API Error:', error);
        res.status(500).json({ message: 'Internal Server Error during login.' });
    }
};