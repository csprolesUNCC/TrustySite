export default async (req, res) => {
    if (req.method !== 'POST') {
        // Log out is best handled by POST to avoid accidental deletion via browser pre-fetching
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // 1. Tell the browser to delete the cookie
        // The key is to set the Max-Age (or Expires) to zero or a date in the past.
        res.setHeader('Set-Cookie', `authToken=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);

        // 2. Send a successful response
        res.status(200).json({ message: 'Logged out successfully.' });

    } catch (error) {
        console.error('Logout API Error:', error);
        res.status(500).json({ message: 'Internal Server Error during logout.' });
    }
};