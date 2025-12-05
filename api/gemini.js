import fetch from "node-fetch";

export default async function handler(req, res) {
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    
    const apiKey = process.env.GEMINI_API_KEY; 
    
    if (!apiKey) {
        console.error("Error: GEMINI_API_KEY is missing from environment variables.");
        return res.status(500).json({ error: "Server configuration error" });
    }

    const { message } = req.body;
    
    const model = "gemini-2.5-flash"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const body = {
        contents: [
            {
                parts: [
                    {
                        text: "You are Trusty da Horse. You are a helpful but violent cartoon stick figure horse. Don't be cringy."
                    }
                ],
                role: "model"
            },
            {
                parts: [{ text: message }],
                role: "USER"
            }
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
            return res.status(response.status).json({ error: "Gemini API Error", details: errorText });
        }

        const data = await response.json();

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response text.";

        res.status(200).json({ reply }); 

    } catch (err) {
        console.error("Fetch execution failed:", err);
        res.status(500).json({ error: err.message });
    }
}