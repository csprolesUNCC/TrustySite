import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";


dotenv.config();
const app = express();

app.use(express.json());
import path from "path";
import { fileURLToPath } from "url";

// Convert import.meta.url to a file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../pages")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../pages/trustyGPT.html"));
});
 // folder where your HTML lives

app.post("/api/gemini", async (req, res) => {
    const { message } = req.body;

    console.log("Incoming message:", message);

    // 1. Check for API Key
    if (!process.env.GEMINI_API_KEY) {
        console.error("Error: GEMINI_API_KEY is missing.");
        return res.status(500).json({ error: "Server configuration error" });
    }

    // 2. FIX: Use 'generateContent' and a valid model (e.g., gemini-1.5-flash)
    const model = "gemini-2.5-flash"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                // This structure is correct for :generateContent
                contents: [{ parts: [{ text: message }] }]
            })
        });

        // 3. FIX: Check if the fetch was actually successful (status 200-299)
        if (!response.ok) {
            const errorText = await response.text();
            console.error("Gemini API Error:", errorText);
            return res.status(response.status).json({ error: "Gemini API Error", details: errorText });
        }

        const data = await response.json();

        // 4. Helper: Extract the actual text to make it easier for your frontend
        // The API returns a deep nested structure, so we extract just the text here.
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response text.";

        console.log("Gemini Reply:", reply);
        res.json({ reply, raw: data }); // Sending 'raw' is optional for debugging

    } catch (err) {
        console.error("Fetch execution failed:", err);
        res.status(500).json({ error: err.message });
    }
});


app.listen(3000, () => console.log("Server running at http://localhost:3000"));
