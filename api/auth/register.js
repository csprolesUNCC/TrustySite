import bcrypt from 'bcryptjs';
import connectToDatabase from '../../utils/connect.js';
import { usernameProblem, passwordProblem } from '../../scripts/username.js';
import { countHit, clientIp } from '../../utils/rate-limit.js';
const SALT_ROUNDS = 10;

export default async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // Only plain strings go anywhere near the database query below.
        const text = (value) => (typeof value === 'string' ? value.trim() : '');
        const username = text(req.body?.username);
        // Store emails in lowercase
        const email = text(req.body?.email).toLowerCase();
        const password = req.body?.password;

        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Missing required fields.' });
        }
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: 'That email address doesn’t look right.' });
        }
        // The same rules as changing your username (utils/rename.js) and resetting a password.
        const problem = usernameProblem(username) || passwordProblem(password);
        if (problem) {
            return res.status(400).json({ message: problem });
        }

        // At most 10 sign-ups an hour from one IP address, so nobody can script a pile of accounts.
        if (await countHit(`register:${clientIp(req)}`, 60 * 60 * 1000) > 10) {
            return res.status(429).json({ message: 'Too many new accounts from here. Try again in an hour.' });
        }

        const { db } = await connectToDatabase();

        const usersCollection = db.collection('users');

        // Collation catches duplicates against old mixed-case emails.
        // Note: this also makes the username check case-insensitive ("Bob" and "bob" conflict).
        const existingUser = await usersCollection.findOne(
            { $or: [{ email }, { username }] },
            { collation: { locale: 'en', strength: 2 } }
        );
        if (existingUser) {
            return res.status(409).json({ message: 'Email or username already in use.' });
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = {
            username,
            email,
            password: hashedPassword,
            createdAt: new Date(),
        };

        await usersCollection.insertOne(newUser);

        res.status(201).json({ message: 'Registration successful! Please log in.' });

    } catch (error) {
        console.error('Registration API Error:', error);
        res.status(500).json({ message: 'Internal Server Error during registration.' });
    }
};