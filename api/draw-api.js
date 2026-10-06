import { connectToDatabase } from '../utils/db.js';
import { authenticateUser } from '../utils/auth.js';
import { decodePngDataUrl } from '../utils/png.js';
import { PNG_DATA_URL, drawingKey, drawingFilter } from '../utils/drawings.js';
import { gradeDrawing, GRADER_VERSION } from '../scripts/draw-grader.js';

// Drawings are shown to every visitor, so only accept a real PNG data URL of sane size.
const MAX_IMAGE_LENGTH = 1_000_000;

// Scores from older graders aren't comparable, so boards and personal bests only count the current one.
const CURRENT = { grader: GRADER_VERSION };

export default async (req, res) => {
    const { action } = req.query;
    try {
        const db = await connectToDatabase();
        const collection = db.collection('draw_scores');

        // --- HANDLER 1: GET LEADERBOARD ---
        // Each drawing comes with what the Report button needs (see utils/drawings.js).
        if (req.method === 'GET' && action === 'get_leaderboard') {
            const user = authenticateUser(req);
            const scores = await collection
                .find(CURRENT)
                .project({ name: 1, score: 1, drawing: 1, timestamp: 1, reportedBy: 1 })
                .sort({ score: -1, timestamp: 1 })
                .limit(10)
                .toArray();
            return res.status(200).json(scores.map((s) => ({
                name: s.name,
                score: s.score,
                drawing: s.drawing,
                ...drawingKey(s, user),
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

            // A new drawing starts over with no reports.
            await collection.updateOne(
                { userId: user.userId },
                {
                    $set: {
                        userId: user.userId,
                        name: user.username,
                        score: graded,
                        drawing: image,
                        grader: GRADER_VERSION,
                        timestamp: new Date(),
                        reports: 0,
                        reportedBy: []
                    }
                },
                { upsert: true }
            );
            return res.status(201).json({ message: 'Score saved!', score: graded });
        }

        // --- HANDLER 4: REPORT A DRAWING ---
        // POST { id, at } (see utils/drawings.js). Every player can report a drawing once (`reportedBy`).
        // `reports` counts the reports the admins haven't cleared yet, and pages/admin.html shows the
        // drawings with the most first.
        if (req.method === 'POST' && action === 'report') {
            const user = authenticateUser(req);
            if (!user) return res.status(401).json({ error: 'Auth required' });

            const drawing = drawingFilter(req.body);
            if (!drawing) return res.status(400).json({ error: 'Invalid drawing' });

            const added = await collection.updateOne(
                { ...drawing, userId: { $ne: user.userId }, reportedBy: { $ne: user.userId } },
                { $push: { reportedBy: user.userId }, $inc: { reports: 1 } }
            );
            if (added.matchedCount) return res.status(200).json({ reported: true });

            // Nothing changed: find out why.
            const doc = await collection.findOne(drawing, { projection: { userId: 1 } });
            if (!doc) return res.status(404).json({ error: 'That drawing isn’t up anymore.' });
            if (doc.userId === user.userId) return res.status(400).json({ error: 'You can’t report your own drawing.' });
            return res.status(200).json({ reported: true, already: true });
        }

        return res.status(400).json({ error: 'Invalid action or method' });

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
