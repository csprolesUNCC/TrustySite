import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import connectToDatabase from '../../utils/connect.js';
import { authenticateUser } from '../../utils/auth.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
}

export default async (req, res) => {

    if (req.method === 'GET') {
        const user = authenticateUser(req);

        if (user) {
            return res.status(200).json({ 
                isLoggedIn: true, 
                username: user.username 
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

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' });

        res.setHeader('Set-Cookie', `authToken=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24}`); // 1 day in seconds
        res.status(200).json({ message: 'Login successful', username: user.username });

    } catch (error) {
        console.error('Login API Error:', error);
        res.status(500).json({ message: 'Internal Server Error during login.' });
    }
};