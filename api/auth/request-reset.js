import crypto from 'crypto';
import { Resend } from 'resend';
import connectToDatabase from '../../utils/connect.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    try {
        const { db } = await connectToDatabase();

        const email = req.body?.email?.trim().toLowerCase();

        if (!email) return res.status(400).json({ message: 'Email is required.' });

        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne(
            { email },
            { collation: { locale: 'en', strength: 2 } }
        );

        if (!user) {
            return res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = Date.now() + 3600000; // 1 hour

        const result = await usersCollection.updateOne(
            { _id: user._id },
            { $set: { resetToken, resetTokenExpiry } }
        );

        console.log('Reset token update:', {
            matched: result.matchedCount,
            modified: result.modifiedCount,
            db: db.databaseName,
            userId: user._id
        });

        if (result.matchedCount === 0) {
            console.error('Reset token was not saved for user:', user._id);
            return res.status(500).json({ message: 'Internal Server Error' });
        }

        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers['host'];
        const resetLink = `${protocol}://${host}/pages/auth/reset-password.html?token=${resetToken}`;

        const { data, error } = await resend.emails.send({
            from: 'Support <support@trustydahorse.com>',
            to: [user.email],
            subject: 'Reset Your Password - Trusty da Horse',
            html: `
                <h3>Password Reset</h3>
                <p>Click the link below to set a new password:</p>
                <a href="${resetLink}">Reset Password</a>
                <p>This link expires in 1 hour.</p>
            `
        });

        if (error) {
            console.error('Resend API Error:', error);
            return res.status(500).json({ message: 'Error sending email.' });
        }

        console.log(`Email sent to ${user.email} via Resend ID: ${data.id}`);
        res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });

    } catch (error) {
        console.error('Request Reset Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};