import crypto from 'crypto';
import connectToDatabase from './connect.js';

export default async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    try {
        const { db } = await connectToDatabase();
        const { email } = req.body;

        if (!email) return res.status(400).json({ message: 'Email is required.' });

        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ email });

        if (!user) {
            // Security: Don't reveal if the email exists or not
            return res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });
        }

        // 1. Generate a random reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        
        // 2. Set expiration (1 hour from now)
        const resetTokenExpiry = Date.now() + 3600000; 

        // 3. Save token to DB
        await usersCollection.updateOne(
            { email },
            { $set: { resetToken, resetTokenExpiry } }
        );

        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers['trustydahorse.com'];
        const resetLink = `${protocol}://${host}/pages/auth/reset-password.html?token=${resetToken}`;

        // IMPORTANT: Since we don't have an email provider set up, 
        // we log this to the Vercel Function Logs. check your Vercel dashboard logs to see this link!
        console.log(`PASSWORD RESET LINK FOR ${email}: ${resetLink}`);

        res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });

    } catch (error) {
        console.error('Request Reset Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};