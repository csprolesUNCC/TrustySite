import fetch from "node-fetch";

// TrustyGPT: sends the chat to Gemini with Trusty's persona as the system instruction.
// POST { message, history? } -> { reply }. `history` is the conversation so far, oldest first, as
// [{ role: "user" | "model", text }]; only the last few turns are kept so requests stay small.

const MODEL = "gemini-2.5-flash";
const PERSONA = "You are Trusty da Horse. You are a helpful but violent cartoon stick figure horse. Don't be cringy.";
const MAX_TURNS = 10;
const MAX_CHARS = 2000;

// The earlier turns, cleaned up: right roles only, trimmed to size, and starting with the user and
// alternating, as Gemini expects.
function recentTurns(history) {
    if (!Array.isArray(history)) return [];
    const turns = [];
    for (const turn of history.slice(-MAX_TURNS)) {
        if (!turn || (turn.role !== "user" && turn.role !== "model") || typeof turn.text !== "string") continue;
        const text = turn.text.trim().slice(0, MAX_CHARS);
        if (!text) continue;
        const expected = turns.length % 2 === 0 ? "user" : "model";
        if (turn.role !== expected) continue;
        turns.push({ role: turn.role, parts: [{ text }] });
    }
    // The new message is the user's turn, so the history must end on Trusty's.
    if (turns.length % 2 === 1) turns.pop();
    return turns;
}

export default async function handler(req, res) {

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("Error: GEMINI_API_KEY is missing from environment variables.");
        return res.status(500).json({ error: "Server configuration error" });
    }

    const { message, history } = req.body || {};
    if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "Message required" });
    }
    if (message.length > MAX_CHARS) {
        return res.status(400).json({ error: `Keep it under ${MAX_CHARS} characters.` });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    const body = {
        systemInstruction: { parts: [{ text: PERSONA }] },
        contents: [
            ...recentTurns(history),
            { role: "user", parts: [{ text: message.trim() }] }
        ]
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Gemini API Error:", errorText);
            return res.status(response.status).json({ error: "Gemini API Error" });
        }

        const data = await response.json();

        const reply = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "No response text.";

        res.status(200).json({ reply });

    } catch (err) {
        console.error("Fetch execution failed:", err);
        res.status(500).json({ error: "Could not reach Gemini" });
    }
}
