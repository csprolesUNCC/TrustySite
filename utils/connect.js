import { MongoClient } from 'mongodb';

const uri = process.env.USERS_MONGODB_URI;
if (!uri) {
    throw new Error('MONGODB_URI is not defined in environment variables.');
}

let cachedClient = null;
let cachedDb = null;

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
        throw new Error('Database connection failed.');
    }
}

export default connectToDatabase;