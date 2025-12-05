import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI; 
const client = new MongoClient(uri);

async function connectToDatabase() {
    if (!client.topology || !client.topology.isConnected()) {
        await client.connect();
    }
    return client.db("flappy_scores");
}

export { connectToDatabase };