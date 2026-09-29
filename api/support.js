// Trusty Support: a visitor opens a chat, Trusty picks one of the team at random and emails
// them a private link, and the two talk through this endpoint (both sides poll for new messages).
//
//   POST ?action=start  { name?, message }   -> { id, key, agent }   (visitor's key)
//   GET  ?id=&after=N   header X-Support-Key -> chat state + messages from index N
//   POST ?action=send   { id, text }         header X-Support-Key
//   POST ?action=close  { id }               header X-Support-Key
//
// Each chat has two keys: the visitor's (kept in their browser) and the agent's (only in the
// email link). Whichever key is sent decides which side you're on.
//
// SUPPORT_AGENTS lists the team as "Name:email" pairs, comma-separated, e.g.
//   SUPPORT_AGENTS="Luke:luke@example.com,Will:will@example.com,Matthew:...,Carson:..."
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { Resend } from 'resend';
import { connectToDatabase } from './db.js';
import { authenticateUser } from '../utils/auth.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const MAX_TEXT = 1000;
const MAX_NAME = 40;
const MAX_MESSAGES = 300;
const CHATS_PER_HOUR = 3;          // per visitor IP
const HERE_MS = 25 * 1000;         // seen this recently = "here"
const RENOTIFY_MS = 10 * 60 * 1000; // at most one "new message" email per chat per 10 minutes

function agents() {
    return (process.env.SUPPORT_AGENTS || '')
        .split(',')
        .map((entry) => {
            const i = entry.indexOf(':');
            return { name: entry.slice(0, i).trim(), email: entry.slice(i + 1).trim() };
        })
        .filter((a) => a.name && a.email.includes('@'));
}

function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

function cleanText(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
}

function clientIpHash(req) {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
    return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

function sameKey(given, actual) {
    if (typeof given !== 'string' || typeof actual !== 'string' || !given) return false;
    const x = Buffer.from(given);
    const y = Buffer.from(actual);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function chatLink(req, chat) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['host'];
    // The key rides in the hash so it never shows up in server logs or referrers.
    return `${protocol}://${host}/pages/support.html#chat=${chat._id}&key=${chat.agentKey}`;
}

async function emailAgent(req, chat, agent, { subject, intro, text }) {
    const { error } = await resend.emails.send({
        from: 'Trusty Support <support@trustydahorse.com>',
        to: [agent.email],
        subject: oneLine(subject).slice(0, 120),
        html: `
            <p>Hey ${escapeHtml(agent.name)},</p>
            <p>${intro}</p>
            <blockquote style="margin:12px 0;padding:10px 14px;border-left:4px solid #1b1b1f;background:#fbf8f0;white-space:pre-wrap">${escapeHtml(text)}</blockquote>
            <p><a href="${chatLink(req, chat)}">Open the chat</a></p>
            <p style="color:#666;font-size:13px">This link is your key to the chat, so don't forward it.</p>
        `,
    });
    if (error) console.error('Support email error:', error);
    return !error;
}

async function findChat(collection, req, id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) return null;
    const chat = await collection.findOne({ _id: new ObjectId(id) });
    if (!chat) return null;
    const key = req.headers['x-support-key'];
    if (sameKey(key, chat.visitorKey)) return { chat, role: 'visitor' };
    if (sameKey(key, chat.agentKey)) return { chat, role: 'agent' };
    return null;
}

function publicState(chat, role, after) {
    const other = role === 'agent' ? 'visitor' : 'agent';
    const seen = chat[`${other}SeenAt`];
    const start = Math.max(0, Math.min(after, chat.messages.length));
    return {
        role,
        status: chat.status,
        agent: chat.agentName,
        visitor: chat.visitorName,
        agentJoined: Boolean(chat.agentJoinedAt),
        otherHere: Boolean(seen && Date.now() - new Date(seen).getTime() < HERE_MS),
        total: chat.messages.length,
        messages: chat.messages.slice(start).map(({ from, text, at }) => ({ from, text, at })),
    };
}

export default async (req, res) => {
    const { action } = req.query;

    try {
        const db = await connectToDatabase();
        const collection = db.collection('support_chats');

        // --- Poll: both sides call this every few seconds ---
        if (req.method === 'GET') {
            const found = await findChat(collection, req, req.query.id);
            if (!found) return res.status(404).json({ error: 'Chat not found' });
            let { chat, role } = found;

            const now = new Date();
            const update = { $set: { [`${role}SeenAt`]: now } };
            const filter = { _id: chat._id };
            // The agent's first visit announces them in the chat.
            if (role === 'agent' && !chat.agentJoinedAt && chat.status === 'open') {
                update.$set.agentJoinedAt = now;
                update.$push = { messages: { from: 'system', text: `${chat.agentName} joined the chat`, at: now } };
                filter.agentJoinedAt = null;
            }
            // No match only if another poll just announced the agent; the next poll catches up.
            chat = (await collection.findOneAndUpdate(filter, update, { returnDocument: 'after' })) || chat;

            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json(publicState(chat, role, Number(req.query.after) || 0));
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

        // --- Start a chat: pick a random teammate and email them ---
        if (action === 'start') {
            const team = shuffle(agents());
            if (!team.length) return res.status(503).json({ error: 'Support is closed right now.' });

            const text = cleanText(req.body?.message, MAX_TEXT);
            if (!text) return res.status(400).json({ error: 'Tell Trusty what the problem is.' });

            const user = authenticateUser(req);
            const visitorName = oneLine(user?.username || cleanText(req.body?.name, MAX_NAME)) || 'A visitor';

            const ipHash = clientIpHash(req);
            const recent = await collection.countDocuments({ ipHash, createdAt: { $gt: new Date(Date.now() - 3600000) } });
            if (recent >= CHATS_PER_HOUR) {
                return res.status(429).json({ error: "You've opened a lot of chats. Try again in an hour." });
            }

            const now = new Date();
            const chat = {
                _id: new ObjectId(),
                status: 'open',
                createdAt: now,
                visitorKey: crypto.randomBytes(24).toString('hex'),
                agentKey: crypto.randomBytes(24).toString('hex'),
                visitorName,
                userId: user?.userId || null,
                ipHash,
                agentJoinedAt: null,
                visitorSeenAt: now,
                agentSeenAt: null,
                notifiedAt: now,
                messages: [{ from: 'visitor', text, at: now }],
            };

            // Try teammates in random order until one email goes through.
            let agent = null;
            for (const candidate of team) {
                chat.agentName = candidate.name;
                chat.agentEmail = candidate.email;
                const sent = await emailAgent(req, chat, candidate, {
                    subject: `Trusty Support: ${visitorName} needs help`,
                    intro: `<strong>${escapeHtml(visitorName)}</strong> opened a support chat and Trusty picked you. They said:`,
                    text,
                });
                if (sent) { agent = candidate; break; }
            }
            if (!agent) return res.status(502).json({ error: "Trusty couldn't reach anyone. Try again later." });

            await collection.insertOne(chat);

            return res.status(201).json({ id: String(chat._id), key: chat.visitorKey, agent: agent.name });
        }

        const found = await findChat(collection, req, req.body?.id);
        if (!found) return res.status(404).json({ error: 'Chat not found' });
        const { chat, role } = found;
        if (chat.status !== 'open') return res.status(409).json({ error: 'This chat has ended.' });

        // --- Send a message ---
        if (action === 'send') {
            const text = cleanText(req.body?.text, MAX_TEXT);
            if (!text) return res.status(400).json({ error: 'Empty message' });

            const now = new Date();
            const result = await collection.updateOne(
                { _id: chat._id, status: 'open', [`messages.${MAX_MESSAGES - 1}`]: { $exists: false } },
                { $push: { messages: { from: role, text, at: now } }, $set: { [`${role}SeenAt`]: now } }
            );
            if (!result.matchedCount) return res.status(409).json({ error: 'This chat is full. Start a new one.' });

            // Nudge the agent by email if they aren't watching the chat (throttled).
            const agentAway = !chat.agentSeenAt || Date.now() - new Date(chat.agentSeenAt).getTime() > HERE_MS * 2;
            const notifiedLongAgo = !chat.notifiedAt || Date.now() - new Date(chat.notifiedAt).getTime() > RENOTIFY_MS;
            if (role === 'visitor' && agentAway && notifiedLongAgo) {
                const claimed = await collection.updateOne(
                    { _id: chat._id, notifiedAt: chat.notifiedAt },
                    { $set: { notifiedAt: now } }
                );
                if (claimed.modifiedCount) {
                    await emailAgent(req, chat, { name: chat.agentName, email: chat.agentEmail }, {
                        subject: `Trusty Support: new message from ${chat.visitorName}`,
                        intro: `<strong>${escapeHtml(chat.visitorName)}</strong> is still waiting in their support chat:`,
                        text,
                    });
                }
            }
            return res.status(200).json({ ok: true });
        }

        // --- End the chat (either side) ---
        if (action === 'close') {
            const now = new Date();
            const who = role === 'agent' ? chat.agentName : chat.visitorName;
            await collection.updateOne(
                { _id: chat._id, status: 'open' },
                { $set: { status: 'closed', closedAt: now }, $push: { messages: { from: 'system', text: `${who} ended the chat`, at: now } } }
            );
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (error) {
        console.error('Support API Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
