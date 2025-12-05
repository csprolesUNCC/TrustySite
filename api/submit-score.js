import { connectToDatabase } from './db.js';
import { authenticateUser } from '../utils/auth.js'; 

export default async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const user = authenticateUser(req);
    if (!user) {
        return res.status(401).json({ error: 'Authentication required to submit score' });
    }
    
    try {
        const name = user.username; 
        const { score } = req.body;

        if (typeof score !== 'number' || score < 0) {
            return res.status(400).json({ error: 'Invalid score provided' });
        }
        
        const db = await connectToDatabase();
        const collection = db.collection('scores');
        
        const existingScore = await collection.findOne(
            { userId: user.userId },
            { sort: { score: -1 } }
        );

        if (existingScore && score <= existingScore.score) {
            return res.status(200).json({ message: 'Score submitted, but not a new personal high score' });
        }
        
        const newScore = {
            userId: user.userId,
            name: name,
            score: score,
            timestamp: new Date(),
        };

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