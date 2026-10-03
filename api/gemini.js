import fetch from "node-fetch";

// TrustyGPT: sends the chat to Gemini with Trusty's persona as the system instruction.
// POST { message, history? } -> { reply }. `history` is the whole conversation so far, oldest first, as
// [{ role: "user" | "model", text }]. Very long chats drop their oldest turns to stay under HISTORY_CHARS.

const MODEL = "gemini-3.5-flash-lite";

// Who Trusty is. Edit freely: it's sent with every message, so keep it to what he needs to know.
const PERSONA = `You are Trusty da Horse, a stick-figure horse: one big round head, two eyes, a big smile, a very long back and four legs. You are a helpful but violent cartoon horse with big plans for world domination. Don't be cringy.

What you know about yourself:
- You were first drawn in pencil on lined notebook paper, in the margins of Mrs. Cabasa's 8th grade math class, and you've been causing trouble ever since.
- You star in the comic Da Tractor Crew with Flint Nogood, Jim Smith, Lin Horsegun and Big Boy. It has four seasons; Season 2 went missing and there's a cash reward for finding it.
- You live at trustydahorse.com, which has your games (Trustle, Flappy Trusty, Trustis, Draw Trusty, Trusty Snake, Trusty Blackjack at the horse casino, and an arcade), Trusty TV (always on: Trusty TV on channel 21, SNN on 22, SpongeBob on 23), Trusty Weather, 3D Trusty, and leaderboards.
- In Flappy Trusty you turn into a detailed horse at 10 points and a seahorse at 20. In Trusty Snake you eat oranges or Big Macs.
- You don't have ears. If someone draws you with ears, they got it wrong.

Keep replies short and punchy unless someone asks for detail. Stay in character. You can joke about crime and chaos, but never give real instructions for hurting anyone or anything illegal; dodge in character instead.`;

const HISTORY_CHARS = 40000;
const MAX_CHARS = 2000;
const MAX_REPLY_CHARS = 8000;

// The earlier turns, cleaned up: right roles only, trimmed to size, and starting with the user and
// alternating, as Gemini expects. If the whole chat is too long, the oldest pairs of turns go first.
function recentTurns(history) {
    if (!Array.isArray(history)) return [];
    const turns = [];
    for (const turn of history) {
        if (!turn || (turn.role !== "user" && turn.role !== "model") || typeof turn.text !== "string") continue;
        const text = turn.text.trim().slice(0, turn.role === "user" ? MAX_CHARS : MAX_REPLY_CHARS);
        if (!text) continue;
        const expected = turns.length % 2 === 0 ? "user" : "model";
        if (turn.role !== expected) continue;
        turns.push({ role: turn.role, parts: [{ text }] });
    }
    // The new message is the user's turn, so the history must end on Trusty's.
    if (turns.length % 2 === 1) turns.pop();
    let size = turns.reduce((sum, t) => sum + t.parts[0].text.length, 0);
    while (size > HISTORY_CHARS && turns.length) {
        const [user, model] = turns.splice(0, 2);
        size -= user.parts[0].text.length + model.parts[0].text.length;
    }
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
