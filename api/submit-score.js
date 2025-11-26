// api/submit-score.js
import { connectToDatabase } from './db.js';
// NEW: Import the authentication helper
import { authenticateUser } from '../utils/auth.js'; 

export default async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // 1. Authenticate User
    const user = authenticateUser(req);
    if (!user) {
        // Reject score submission if not logged in
        return res.status(401).json({ error: 'Authentication required to submit score' });
    }
    
    try {
        // The name will now come from the authenticated user's username
        const name = user.username; 
        const { score } = req.body;

        if (typeof score !== 'number' || score < 0) {
            return res.status(400).json({ error: 'Invalid score provided' });
        }
        
        const db = await connectToDatabase();
        const collection = db.collection('scores');
        
        // 2. Check for existing high score for this user
        // We use the unique user ID from the JWT payload to find the specific user's high score
        const existingScore = await collection.findOne(
            { userId: user.userId },
            { sort: { score: -1 } } // Fetch the highest score
        );

        if (existingScore && score <= existingScore.score) {
            // New score is NOT a high score, so we don't save it
            return res.status(200).json({ message: 'Score submitted, but not a new personal high score' });
        }
        
        // 3. Prepare the new score object, including the unique userId
        const newScore = {
            userId: user.userId, // Key change: store the user ID for uniqueness
            name: name,          // Use the authenticated username
            score: score,
            timestamp: new Date(),
        };

        // 4. Update or Insert (Upsert) the score
        // Use updateOne with upsert:true to only keep one entry per user ID in the leaderboard
        // NOTE: This logic assumes you want ONLY the single highest score saved
        await collection.updateOne(
            { userId: user.userId },
            { $set: newScore },
            { upsert: true }
        );

        res.status(201).json({ message: 'New high score saved!' });
    } catch (error) {
        console.error("Error submitting score:", error);
        res.status(500).json({ error: 'Failed to submit score' });
    }
};