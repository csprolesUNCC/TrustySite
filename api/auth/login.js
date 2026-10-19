import bcrypt from 'bcryptjs';
import connectToDatabase from '../../utils/connect.js';
import { authenticateUser, isAdmin, setAuthCookie, shouldRenew } from '../../utils/auth.js';
import { copyName, currentUsername } from '../../utils/rename.js';

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
        const { db } = await connectToDatabase();

        // Accept either an email or a username. The form field may still be
        // named "email", so fall back to that for backwards compatibility.
        const identifier = (req.body?.identifier ?? req.body?.email)?.trim();
        const password = req.body?.password;

        if (!identifier || !password) {
            return res.status(400).json({ message: 'Missing required fields.' });
        }

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
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

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