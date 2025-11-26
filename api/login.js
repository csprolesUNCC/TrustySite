const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const connectToDatabase = require('./connect');

// Get JWT Secret from Vercel environment variables
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
}

module.exports = async (req, res) => {
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

        // 1. Find user by email
        const user = await usersCollection.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // 2. Compare the provided password with the stored hash
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // 3. Create payload for JWT (only non-sensitive data)
        const tokenPayload = { 
            userId: user._id, 
            username: user.username 
        };

        // 4. Sign the JWT (expires in 1 day)
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' });

        // 5. Set the token in a secure, HTTP-only cookie
        // HttpOnly: Prevents client-side JS from accessing the cookie (better security)
        // Secure: Requires HTTPS (Vercel provides this)
        // SameSite=Strict: Protection against CSRF
        res.setHeader('Set-Cookie', `authToken=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24}`); // 1 day in seconds

        // 6. Success response, sending the username back for the component display
        res.status(200).json({ message: 'Login successful', username: user.username });

    } catch (error) {
        console.error('Login API Error:', error);
        res.status(500).json({ message: 'Internal Server Error during login.' });
    }
};