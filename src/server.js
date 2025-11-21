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

    // Use a placeholder URL/Key structure for demonstration
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
      process.env.GEMINI_API_KEY;

    // Implementation for calling Gemini API...
    // Removed API call boilerplate for brevity and security, assuming the functionality is handled elsewhere.
    // For local testing, you might mock this or ensure your environment variables are set.

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: message }] }]
            })
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Gemini API call failed:", error);
        res.status(500).json({ error: "Failed to communicate with the AI service." });
    }
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));