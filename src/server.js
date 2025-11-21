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
  res.sendFile(path.join(__dirname, "../src/pages/trustyGPT.html"));
});
 // folder where your HTML lives

app.post("/api/gemini", async (req, res) => {
    const { message } = req.body;

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
      process.env.GEMINI_API_KEY;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: message }] }]
        })
    });

    const data = await response.json();
    res.json(data);
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));
