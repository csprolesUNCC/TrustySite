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

        // Accounts are looked up by username or email ignoring capitals (login, sign-up, profiles, password resets),
        // so these indexes use the same collation those queries do. Named, so they sit beside any older plain ones.
        // Made once per server start; never holds up a request.
        const users = db.collection('users');
        for (const field of ['username', 'email']) {
            users.createIndex({ [field]: 1 }, { name: `${field}_ci`, collation: { locale: 'en', strength: 2 } }).catch((error) => {
                if (error && (error.code === 85 || error.code === 86)) return;
                console.error(`Index users.${field} failed:`, error);
            });
        }
        
        console.log('Successfully connected to MongoDB.');
        return { client, db };
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        throw new Error('Database connection failed.');
    }
}

export default connectToDatabase;