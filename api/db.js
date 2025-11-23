// api/db.js
import { MongoClient } from 'mongodb';

// Get the connection string from environment variables
const uri = process.env.MONGODB_URI; 
const client = new MongoClient(uri);

async function connectToDatabase() {
    // Vercel serverless functions are often stateless, 
    // but we can try to reuse the connection.
    if (!client.topology || !client.topology.isConnected()) {
        await client.connect();
    }
    return client.db("flappy_scores"); // Use a specific database name
}

export { connectToDatabase };