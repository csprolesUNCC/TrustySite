import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI; 
const client = new MongoClient(uri);

// The indexes the site's queries need: every game collection is looked up by `userId`, and the boards sort (and
// profiles count ranks) by score. Made once per server start; a collection that already has one is left alone, so
// this costs a few quick commands, and it never holds up a request. An entry is a key, or [key, options].
const INDEXES = {
    // `username`: the Item Shop looks up how names on a page look (utils/shop.js).
    click_game: [{ userId: 1 }, { clicks: -1 }, { username: 1 }],
    scores: [{ userId: 1 }, { score: -1, timestamp: 1 }], // Flappy Trusty
    draw_scores: [{ userId: 1 }, { grader: 1, score: -1, timestamp: 1 }],
    trustis_scores: [{ userId: 1 }, { score: -1, timestamp: 1 }],
    snake_scores: [{ userId: 1 }, { score: -1, timestamp: 1 }],
    trustle: [{ userId: 1 }],
    profiles: [{ userId: 1 }],
    // The Daily Games board (utils/daily.js): one result per player per game per day.
    daily_scores: [[{ userId: 1, game: 1, day: 1 }, { unique: true }], { day: 1, rank: 1, savedAt: 1 }, { savedAt: -1 }],
    updates: [{ savedAt: -1 }],
};

let indexed = false;
function ensureIndexes(db) {
    if (indexed) return;
    indexed = true;
    for (const [name, keys] of Object.entries(INDEXES)) {
        for (const entry of keys) {
            const [key, options] = Array.isArray(entry) ? entry : [entry, {}];
            // 85/86: the same index is already there under another name or with other options, which is fine.
            db.collection(name).createIndex(key, options).catch((error) => {
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
