import Conversation from "./models/Conversation";
import connectDB from "./config/db";
import "dotenv/config";
import express, { Request, Response } from "express";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3-flash-preview";

app.use(express.json({ limit: "20kb" }));

if (!API_KEY) {
  throw new Error("GEMINI_API_KEY missing. Check your .env file.");
}

// Health-check endpoint
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "DevMate AI",
    status: "running",
    model: MODEL,
  });
});

/**
 * GET /api/conversations
 * Returns the latest 50 conversations.
 */
app.get("/api/conversations", async (_req: Request, res: Response) => {
  try {
    const conversations = await Conversation.find()
      .sort({ updatedAt: -1 })
      .limit(50)
      .select("title createdAt updatedAt messages");

    const result = conversations.map((conversation) => ({
      conversationId: conversation._id.toString(),
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
    }));

    res.json({
      count: result.length,
      conversations: result,
    });
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    res.status(500).json({
      error: "Could not retrieve conversations.",
    });
  }
});

/**
 * GET /api/conversations/:id
 * Returns one conversation with its messages.
 */
app.get(
  "/api/conversations/:id",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!/^[a-f\d]{24}$/i.test(id)) {
        res.status(400).json({
          error: "Invalid conversation ID.",
        });
        return;
      }

      const conversation = await Conversation.findById(id);

      if (!conversation) {
        res.status(404).json({
          error: "Conversation not found.",
        });
        return;
      }

      res.json({
        conversationId: conversation._id.toString(),
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages,
      });
    } catch (error) {
      console.error("Failed to fetch conversation:", error);
      res.status(500).json({
        error: "Could not retrieve conversation.",
      });
    }
  }
);

// AI chat endpoint

app.post("/api/chat", async (req: Request, res: Response) => {
  const { message, conversationId } = req.body as {
    message?: unknown;
    conversationId?: unknown;
  };

  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Please provide a valid message." });
    return;
  }

  if (message.length > 10000) {
    res.status(400).json({
      error: "Message is too long. Maximum length is 10,000 characters.",
    });
    return;
  }

  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" ||
      !/^[a-f\d]{24}$/i.test(conversationId))
  ) {
    res.status(400).json({ error: "Invalid conversationId." });
    return;
  }

  try {
    let conversation;

    if (conversationId) {
      conversation = await Conversation.findById(conversationId);

      if (!conversation) {
        res.status(404).json({ error: "Conversation not found." });
        return;
      }
    } else {
      conversation = new Conversation({
        title: message.trim().slice(0, 60),
        messages: [],
      });
    }

    // Save the user's message
    conversation.messages.push({
      role: "user",
      content: message.trim(),
      createdAt: new Date(),
    });

    // Send conversation history to Gemini
    const contents = conversation.messages.map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY!,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: `You are DevMate AI, a helpful software development assistant.
Help developers with JavaScript, TypeScript, Node.js, Express,
React, APIs, debugging, Git, and software engineering.
Explain concepts clearly and provide practical code examples when useful.
Never claim you executed code or accessed a repository unless you actually did.`,
            }],
          },
          contents,
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
          },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", response.status, data);
      res.status(502).json({
        error: "The AI service could not process your request.",
      });
      return;
    }

    const reply = data.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("\n")
      .trim();

    if (!reply) {
      res.status(502).json({
        error: "The AI returned an empty response.",
      });
      return;
    }

    // Save the assistant's reply and persist the conversation
    conversation.messages.push({
      role: "assistant",
      content: reply,
      createdAt: new Date(),
    });

    await conversation.save();

    res.json({
      conversationId: conversation._id.toString(),
      reply,
      model: MODEL,
      messageCount: conversation.messages.length,
    });
  } catch (error) {
    console.error("Chat request failed:", error);
    res.status(500).json({
      error: "The chat request failed. Please try again.",
    });
  }
});

app.post("/api/debug", async (req: Request, res: Response) => {
  const { language, code, error } = req.body as {
    language?: unknown;
    code?: unknown;
    error?: unknown;
  };

  // 1. Validate required fields
  if (
    typeof language !== "string" ||
    !language.trim() ||
    typeof code !== "string" ||
    !code.trim()
  ) {
    res.status(400).json({
      error: "Both language and code are required.",
    });
    return;
  }

  // 2. Validate input lengths
  if (
    language.length > 50 ||
    code.length > 15000 ||
    (error !== undefined &&
      (typeof error !== "string" || error.length > 5000))
  ) {
    res.status(400).json({
      error: "Input is too long or has an invalid format.",
    });
    return;
  }

  try {
    const prompt = `
You are DevMate AI, an experienced software debugging assistant.

Analyze the following code and provide:

1. Error explanation
2. Likely root cause
3. Corrected code in a code block
4. How to prevent this issue

Be accurate. If the exact cause cannot be confirmed, explain your assumptions.
Do not claim that you executed the code.

Programming language: ${language}

Error message:
${typeof error === "string" && error.trim()
  ? error
  : "No error message provided. Review the code for likely bugs."}

Code:
\`\`\`${language}
${code}
\`\`\`
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY!,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are DevMate AI, a precise software debugging assistant.",
            }],
          },
          contents: [{
            role: "user",
            parts: [{ text: prompt }],
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini debug API error:", response.status, data);
      res.status(502).json({
        error: "The AI service could not analyze the code.",
      });
      return;
    }

    const analysis = data.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("\n")
      .trim();

    if (!analysis) {
      res.status(502).json({
        error: "The AI returned an empty analysis.",
      });
      return;
    }

    res.json({
      language,
      analysis,
      model: MODEL,
    });
  } catch (err) {
    console.error("Debug request failed:", err);
    res.status(504).json({
      error: "The debugging request timed out or the service is unavailable.",
    });
  }
});


app.post("/api/review", async (req: Request, res: Response) => {
  const { language, code } = req.body as {
    language?: unknown;
    code?: unknown;
  };

  // Validate input
  if (
    typeof language !== "string" ||
    !language.trim() ||
    typeof code !== "string" ||
    !code.trim()
  ) {
    res.status(400).json({
      error: "Both language and code are required.",
    });
    return;
  }

  if (language.length > 50 || code.length > 15000) {
    res.status(400).json({
      error: "Language or code exceeds the allowed length.",
    });
    return;
  }

  try {
    const prompt = `
Review the following code as an experienced software engineer.

Programming language: ${language}

Analyze these areas:
1. Bugs and logical errors
2. Security vulnerabilities
3. Performance issues
4. Readability and maintainability
5. Best practices

For each issue, explain its severity (High, Medium, or Low),
identify the relevant code or pattern, and recommend a fix.

If you find no clear issue in a category, say so.
Do not invent vulnerabilities or claim that you executed the code.
Finish with an overall assessment and prioritized recommendations.

Code:
\`\`\`${language}
${code}
\`\`\`
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY!,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are DevMate AI, a careful software code reviewer. Be precise and explain the reasoning behind findings.",
            }],
          },
          contents: [{
            role: "user",
            parts: [{ text: prompt }],
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini review API error:", response.status, data);
      res.status(502).json({
        error: "The AI service could not review the code.",
      });
      return;
    }

    const review = data.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("\n")
      .trim();

    if (!review) {
      res.status(502).json({
        error: "The AI returned an empty review.",
      });
      return;
    }

    res.json({
      language,
      review,
      model: MODEL,
    });
  } catch (err) {
    console.error("Code review request failed:", err);
    res.status(504).json({
      error: "The review request timed out or the service is unavailable.",
    });
  }
});

const startServer = async (): Promise<void> => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(
        `DevMate AI running at http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();