require("dotenv").config();

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY missing from .env");
    return;
  }

  const model = "gemini-3-flash-preview";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  console.log(`Testing model: ${model}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Explain JWT middleware in Express.js in two sentences.",
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();

    console.log("HTTP status:", response.status);

    if (!response.ok) {
      console.log("API error:", JSON.stringify(data, null, 2));
      return;
    }

    const reply = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n");

    console.log("AI reply:", reply || "No text returned.");
  } catch (error) {
    console.error("Request failed:", error.message);
  }
}

testGemini();