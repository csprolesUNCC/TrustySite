// api/get-user-highscore.js
import { connectToDatabase } from './db.js';
import { authenticateUser } from '../utils/auth.js'; // Assuming you create this helper

export default async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).send('Method Not Allowed');
    }

    // 1. Authenticate User
    const user = authenticateUser(req);
    if (!user) {
        // Return 0 if not logged in
        return res.status(200).json({ highScore: 0 }); 
    }
    
    try {
        const db = await connectToDatabase();
        const collection = db.collection('scores');

        // Fetch the highest score for the logged-in user
        const personalHighScore = await collection.findOne(
            { userId: user.userId },
            { sort: { score: -1 } }
        );

        const score = personalHighScore ? personalHighScore.score : 0;

        res.status(200).json({ highScore: score });
    } catch (error) {
        console.error("Error fetching user high score:", error);
        res.status(500).json({ error: 'Failed to fetch user high score' });
    }
};