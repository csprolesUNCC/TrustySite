import { MongoClient } from 'mongodb';

// Get the MongoDB URI from Vercel environment variables
const uri = process.env.USERS_MONGODB_URI;
if (!uri) {
    throw new Error('MONGODB_URI is not defined in environment variables.');
}

// Instantiate the MongoClient and cache the connection
let cachedClient = null;
let cachedDb = null;

/**
 * Connects to MongoDB, reusing the connection if available.
 * @returns {Promise<{client: MongoClient, db: Db}>} The connected client and database instance.
 */
async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db('trusty-users');

        cachedClient = client;
        cachedDb = db;
        
        console.log('Successfully connected to MongoDB.');
        return { client, db };
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        // Important: throw the error so the calling API function can respond with a 500
        throw new Error('Database connection failed.');
    }
}

export default connectToDatabase;