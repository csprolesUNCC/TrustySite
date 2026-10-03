import bcrypt from 'bcryptjs';
import connectToDatabase from '../../utils/connect.js';
const SALT_ROUNDS = 10;

export default async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { db } = await connectToDatabase();

        const username = req.body?.username?.trim();
        // Store emails in lowercase
        const email = req.body?.email?.trim().toLowerCase();
        const password = req.body?.password;

        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Missing required fields.' });
        }

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