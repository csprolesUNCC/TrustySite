import connectToDatabase from 'connect.js';
import { authenticateUser } from '../utils/auth.js';

export default async (req, res) => {
    const user = authenticateUser(req);
    if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const { db } = await connectToDatabase();
        const collection = db.collection('click_game');

        if (req.method === 'GET') {
            const userData = await collection.findOne({ userId: user.userId });
            return res.status(200).json({ 
                clicks: userData ? userData.clicks : 0 
            });
        }

        if (req.method === 'POST') {
            const result = await collection.findOneAndUpdate(
                { userId: user.userId },
                { 
                    $inc: { clicks: 1 },
                    $set: { username: user.username, lastClicked: new Date() } 
                },
                { returnDocument: 'after', upsert: true }
            );

            return res.status(200).json({ 
                clicks: result.value ? result.value.clicks : result.clicks 
            });
        }

        return res.status(405).json({ message: 'Method Not Allowed' });

    } catch (error) {
        console.error('Click API Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};