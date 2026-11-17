import { clearAuthCookie } from '../../utils/auth.js';

export default async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        clearAuthCookie(res);

        res.status(200).json({ message: 'Logged out successfully.' });

    } catch (error) {
        console.error('Logout API Error:', error);
        res.status(500).json({ message: 'Internal Server Error during logout.' });
    }
};