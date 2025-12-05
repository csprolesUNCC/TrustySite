import bcrypt from 'bcryptjs';
import connectToDatabase from '../connect.js';

export default async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    try {
        const { db } = await connectToDatabase();
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ message: 'Missing token or password.' });
        }

        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({
            resetToken: token,
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
                $unset: { resetToken: "", resetTokenExpiry: "" }
            }
        );

        res.status(200).json({ message: 'Password has been reset successfully. Please login.' });

    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};