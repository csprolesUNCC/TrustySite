import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import connectToDatabase from '../connect.js';
import { authenticateUser } from '/utils/auth.js';

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
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Missing required fields.' });
        }

        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({ email });
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