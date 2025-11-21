import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";


dotenv.config();
const app = express();

app.use(express.json());

// Convert import.meta.url to a file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- START: MODIFIED SECTION ---

// 1. Serve static files (CSS, images) from the project root directory (one level up from server.js).
// This makes paths like /styles/stylesheet.css accessible.
app.use(express.static(path.join(__dirname, "..")));

// 2. We can remove the specific line for /pages since the root (..) serves everything.
// If you still want a separate route for pages, you can keep it, but using the root is generally easier for asset serving.
// app.use(express.static(path.join(__dirname, "../pages"))); 

// --- END: MODIFIED SECTION ---

// Set the root path to index.html (or trustyGPT.html, based on your original file)
app.get("/", (req, res) => {
  // Assuming the primary entry point is index.html now that all assets are served from root
  res.sendFile(path.join(__dirname, "../index.html"));
});

// Route for API calls (TrustyGPT)
app.post("/api/gemini", async (req, res) => {
    const { message } = req.body;

    console.log("Incoming message:", message);

    // 1. Check for API Key
    if (!process.env.GEMINI_API_KEY) {w
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