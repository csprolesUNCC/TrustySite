import { ObjectId } from 'mongodb';
import { connectToDatabase } from '../utils/db.js';
import { authenticateUser } from '../utils/auth.js';
import { decodePngDataUrl } from '../utils/png.js';
import { gradeDrawing, GRADER_VERSION } from '../scripts/draw-grader.js';

// Drawings are shown to every visitor, so only accept a real PNG data URL of sane size.
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_IMAGE_LENGTH = 1_000_000;
const DRAWING_ID = /^[a-f0-9]{24}$/i;

// Scores from older graders aren't comparable, so boards and personal bests only count the current one.
const CURRENT = { grader: GRADER_VERSION };

export default async (req, res) => {
    const { action } = req.query;
    try {
        const db = await connectToDatabase();
        const collection = db.collection('draw_scores');

        // --- HANDLER 1: GET LEADERBOARD ---
        // Each drawing comes with its id, for reporting it, and whether you already have. Who reported a
        // drawing (`reportedBy`) stays private; admins only see how many did (utils/admin.js).
        if (req.method === 'GET' && action === 'get_leaderboard') {
            const user = authenticateUser(req);
            const scores = await collection
                .find(CURRENT)
                .project({ name: 1, score: 1, drawing: 1, reportedBy: 1 })
                .sort({ score: -1, timestamp: 1 })
                .limit(10)
                .toArray();
            return res.status(200).json(scores.map((doc) => ({
                id: String(doc._id),
                name: doc.name,
                score: doc.score,
                drawing: doc.drawing,
                reported: Boolean(user) && Array.isArray(doc.reportedBy) && doc.reportedBy.includes(String(user.userId)),
            })));
        }

        // --- HANDLER 2: GET USER HIGH SCORE ---
        if (req.method === 'GET' && action === 'get_personal') {
            const user = authenticateUser(req);
            if (!user) return res.status(200).json({ highScore: 0 });

            const personalHighScore = await collection.findOne(
                { userId: user.userId, ...CURRENT },
                { sort: { score: -1 } }
            );
            return res.status(200).json({ highScore: personalHighScore ? personalHighScore.score : 0 });
        }

        // --- HANDLER 3: SUBMIT SCORE ---
        if (req.method === 'POST' && action === 'submit') {
            const user = authenticateUser(req);
            if (!user) return res.status(401).json({ error: 'Auth required' });

            const { score, image } = req.body;
            if (typeof score !== 'number' || score < 0) {
                return res.status(400).json({ error: 'Invalid score' });
            }
            if (typeof image !== 'string' || image.length > MAX_IMAGE_LENGTH || !PNG_DATA_URL.test(image)) {
                return res.status(400).json({ error: 'Invalid image' });
            }

            // Grade the drawing here rather than trusting the score the browser sent.
            let graded;
            try {
                graded = gradeDrawing(decodePngDataUrl(image, { width: 500, height: 500 }).data).score;
            } catch {
                return res.status(400).json({ error: 'Invalid image' });
            }

            const existingScore = await collection.findOne(
                { userId: user.userId, ...CURRENT },
                { sort: { score: -1 } }
            );

            if (existingScore && graded <= existingScore.score) {
                return res.status(200).json({ message: 'Not a new high score', score: graded });
            }

            // The new drawing replaces the old one, so the old one's reports go with it.
            await collection.updateOne(
                { userId: user.userId },
                {
                    $set: {
                        userId: user.userId,
                        name: user.username,
                        score: graded,
                        drawing: image,
                        grader: GRADER_VERSION,
                        timestamp: new Date()
                    },
                    $unset: { reportedBy: '' }
                },
                { upsert: true }
            );
            return res.status(201).json({ message: 'Score saved!', score: graded });
        }

        // --- HANDLER 4: REPORT A DRAWING ---
        // Logged-in players can report someone else's drawing, once each. Admins see how many reports
        // each drawing has on pages/admin.html.
        if (req.method === 'POST' && action === 'report') {
            const user = authenticateUser(req);
            if (!user) return res.status(401).json({ error: 'Auth required' });

            const id = req.body && req.body.id;
            if (typeof id !== 'string' || !DRAWING_ID.test(id)) {
                return res.status(400).json({ error: 'Invalid drawing' });
            }
            const drawing = await collection.findOne({ _id: new ObjectId(id) }, { projection: { userId: 1 } });
            if (!drawing) {
                return res.status(404).json({ error: 'That drawing isn’t on the site anymore.' });
            }
            if (String(drawing.userId) === String(user.userId)) {
                return res.status(400).json({ error: 'You can’t report your own drawing.' });
            }

            await collection.updateOne({ _id: drawing._id }, { $addToSet: { reportedBy: String(user.userId) } });
            return res.status(200).json({ reported: true });
        }

        return res.status(400).json({ error: 'Invalid action or method' });

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
