const bcrypt = require('bcrypt');
const connectToDatabase = require('./connect.cjs');
const SALT_ROUNDS = 10;

module.exports = async (req, res) => {
    // Vercel serverless functions often handle the request body automatically, 
    // but we add a check for safety.
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { db } = await connectToDatabase();
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Missing required fields.' });
        }

        const usersCollection = db.collection('users');

        // 1. Check if user already exists
        const existingUser = await usersCollection.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(409).json({ message: 'Email or username already in use.' });
        }

        // 2. Hash the password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // 3. Create the new user object
        const newUser = {
            username,
            email,
            password: hashedPassword, // Store the HASHED password
            createdAt: new Date(),
        };

        // 4. Insert into MongoDB
        await usersCollection.insertOne(newUser);

        // 5. Success response
        res.status(201).json({ message: 'Registration successful! Please log in.' });

    } catch (error) {
        console.error('Registration API Error:', error);
        res.status(500).json({ message: 'Internal Server Error during registration.' });
    }
};