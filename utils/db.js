import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI; 
const client = new MongoClient(uri);

// The indexes the site's queries need: every game collection is looked up by `userId`, and the boards sort (and
// profiles count ranks) by score. Made once per server start; a collection that already has one is left alone, so
// this costs a few quick commands, and it never holds up a request.
const INDEXES = {
    click_game: [{ userId: 1 }, { clicks: -1 }],
    scores: [{ userId: 1 }, { score: -1, timestamp: 1 }], // Flappy Trusty
    draw_scores: [{ userId: 1 }, { grader: 1, score: -1, timestamp: 1 }],
    trustis_scores: [{ userId: 1 }, { score: -1, timestamp: 1 }],
    trustle: [{ userId: 1 }],
    profiles: [{ userId: 1 }],
    updates: [{ savedAt: -1 }],
};

let indexed = false;
function ensureIndexes(db) {
    if (indexed) return;
    indexed = true;
    for (const [name, keys] of Object.entries(INDEXES)) {
        for (const key of keys) {
            // 85/86: the same index is already there under another name or with other options, which is fine.
            db.collection(name).createIndex(key).catch((error) => {
                if (error && (error.code === 85 || error.code === 86)) return;
                console.error(`Index ${name} ${JSON.stringify(key)} failed:`, error);
            });
        }
    }
}

async function connectToDatabase() {
    if (!client.topology || !client.topology.isConnected()) {
        await client.connect();
    }
    const db = client.db("flappy_scores");
    ensureIndexes(db);
    return db;
}

export { connectToDatabase };
