import { ObjectId } from 'mongodb';

// Draw Trusty drawings (the `draw_scores` collection) are picked out by their document id plus their
// timestamp. A player's document is reused when they beat their best, so the timestamp makes sure a report
// (api/draw-api.js) or a removal (utils/admin.js) hits the drawing that was on screen, not a newer one.

export const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * What the browser gets to send back about a drawing: { id, at }, plus whether `user` has reported it
 * already. Who else reported it (`reportedBy`) stays on the server.
 */
export function drawingKey(doc, user) {
    return {
        id: String(doc._id),
        at: doc.timestamp instanceof Date ? doc.timestamp.toISOString() : null,
        reported: Boolean(user && Array.isArray(doc.reportedBy) && doc.reportedBy.includes(user.userId)),
    };
}

/**
 * The query for a drawing the browser sent back as { id, at }, or null if that isn't one.
 * Old drawings with no timestamp come back with `at: null` and are matched by id alone.
 */
export function drawingFilter(body) {
    const { id, at } = body || {};
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return null;
    if (at == null) return { _id: new ObjectId(id) };
    const time = typeof at === 'string' ? new Date(at) : null;
    if (!time || Number.isNaN(time.getTime())) return null;
    return { _id: new ObjectId(id), timestamp: time };
}
