// api/submit-score.js
const { connectToDatabase } = require('./db');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const { name, score } = req.body;

        if (!name || typeof score !== 'number' || score < 0) {
            return res.status(400).json({ error: 'Invalid name or score provided' });
        }
        
        const db = await connectToDatabase();
        const collection = db.collection('scores');
        
        const newScore = {
            name: String(name).substring(0, 20), // Truncate name to prevent abuse
            score: score,
            timestamp: new Date(),
        };

        await collection.insertOne(newScore);

        res.status(201).json({ message: 'Score submitted successfully' });
    } catch (error) {
        console.error("Error submitting score:", error);
        res.status(500).json({ error: 'Failed to submit score' });
    }
};