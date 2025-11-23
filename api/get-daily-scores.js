// api/get-daily-scores.js
import { connectToDatabase } from './db.js';

export default async (req, res) => {
    try {
        const db = await connectToDatabase();
        const collection = db.collection('scores');
        
        // Calculate the timestamp for 24 hours ago
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Aggregation pipeline to get the max score per player in the last 24 hours
        const dailyScores = await collection.aggregate([
            {
                // 1. Filter for scores submitted in the last 24 hours
                $match: {
                    timestamp: { $gte: twentyFourHoursAgo }
                }
            },
            {
                // 2. Group by name and find the maximum score for that name
                $group: {
                    _id: "$name",
                    maxScore: { $max: "$score" }
                }
            },
            {
                // 3. Project the output to match the desired format
                $project: {
                    _id: 0, // Exclude the MongoDB ID
                    name: "$_id", // Rename _id to name
                    score: "$maxScore" // Rename maxScore to score
                }
            },
            {
                // 4. Sort by score descending
                $sort: {
                    score: -1
                }
            },
            {
                // 5. Limit to top 10 daily scores
                $limit: 10
            }
        ]).toArray();

        res.status(200).json(dailyScores);
    } catch (error) {
        console.error("Error fetching daily scores:", error);
        res.status(500).json({ error: 'Failed to fetch daily scores' });
    }
};