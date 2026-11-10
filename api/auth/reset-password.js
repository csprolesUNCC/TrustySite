import bcrypt from 'bcryptjs';
import connectToDatabase from '../../utils/connect.js';
import { hashResetToken, RESET_TOKEN } from '../../utils/reset-token.js';
import { passwordProblem } from '../../scripts/username.js';

export default async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    try {
        const token = req.body?.token;
        const newPassword = req.body?.newPassword;

        // The token goes into a database query, so it must be exactly what request-reset.js hands out: a
        // plain string of 64 hex digits. Anything else (like {"$ne": null}) could match someone else's reset.
        if (typeof token !== 'string' || !RESET_TOKEN.test(token) || typeof newPassword !== 'string') {
            return res.status(400).json({ message: 'Invalid or expired token.' });
        }
        const problem = passwordProblem(newPassword);
        if (problem) return res.status(400).json({ message: problem });

        const { db } = await connectToDatabase();
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({
            // resetToken: links emailed before tokens were stored hashed (they last an hour)
            $or: [{ resetTokenHash: hashResetToken(token) }, { resetToken: token }],
            resetTokenExpiry: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired token.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await usersCollection.updateOne(
            { _id: user._id },
            {
                $set: { password: hashedPassword },
                // resetToken: the plain tokens stored before they were hashed
                $unset: { resetTokenHash: '', resetToken: '', resetTokenExpiry: '' }
            }
        );

        res.status(200).json({ message: 'Password has been reset successfully. Please login.' });

    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
