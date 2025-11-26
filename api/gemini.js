// api/gemini.js - Vercel Serverless Function Proxy

// We need to use node-fetch for HTTP requests within the function environment.
import fetch from "node-fetch";

// Vercel/Serverless functions use 'export default' for the entry point.
// 'req' and 'res' here are Vercel's standard Node.js request/response objects.
export default async function handler(req, res) {
    
    // 1. Method Check (Standard for APIs)
    if (req.method !== 'POST') {
        // Use res.status().json() for Vercel/Node environment
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    
    // 2. Accessing the API Key
    // Vercel automatically exposes the environment variable set in the dashboard.
    const apiKey = process.env.GEMINI_API_KEY; 
    
    if (!apiKey) {
        console.error("Error: GEMINI_API_KEY is missing from environment variables.");
        return res.status(500).json({ error: "Server configuration error" });
    }

    // 3. Extract User Message
    // Vercel's request object parses the JSON body automatically.
    const { message } = req.body;
    
    // --- Gemini API Call Parameters (Copied from your server.js logic) ---
    
    const model = "gemini-2.5-flash"; 
    // The key is passed directly in the URL query parameters for security on the server side
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const body = {
        contents: [
            {
                // System instructions for Trusty da Horse
                parts: [
                    {
                        text: "You are Trusty da Horse. You are a helpful but violent cartoon stick figure horse. Don't be cringy."
                    }
                ],
                role: "model"
            },
            {
                // User message
                parts: [{ text: message }],
                role: "USER"
            }
        ]
    };

    try {
        // 4. Execute the secure fetch request
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Gemini API Error:", errorText);
            return res.status(response.status).json({ error: "Gemini API Error", details: errorText });
        }

        const data = await response.json();

        // 5. Extract the final reply text
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response text.";

        // 6. Send the result back to your trustyGPT.html frontend
        res.status(200).json({ reply }); 

    } catch (err) {
        console.error("Fetch execution failed:", err);
        res.status(500).json({ error: err.message });
    }
}