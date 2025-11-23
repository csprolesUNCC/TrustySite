// api/get-scores.js
const { connectToDatabase } = require('./db');

module.exports = async (req, res) => {
    try {
        const db = await connectToDatabase();
        const collection = db.collection('scores');

        // Fetch top 10 scores, sorted by score descending, and limit the fields
        const scores = await collection
            .find({})
            .sort({ score: -1, timestamp: 1 }) // Secondary sort by timestamp for ties
            .limit(10)
            .toArray();

        res.status(200).json(scores);
    } catch (error) {
        console.error("Error fetching scores:", error);
        res.status(500).json({ error: 'Failed to fetch scores' });
    }
};