// api/db.js
const { MongoClient } = require('mongodb');

// Get the connection string from environment variables (see Step 3)
const uri = process.env.MONGODB_URI; 
const client = new MongoClient(uri);

async function connectToDatabase() {
    if (!client.isConnected()) {
        await client.connect();
    }
    return client.db("flappy_scores"); // Use a specific database name
}

module.exports = { connectToDatabase };