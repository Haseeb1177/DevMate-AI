
import { useCallback, useEffect, useState } from "react";

type Mode = "chat" | "debug" | "review";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  id: string;
  title: string;
  messageCount?: number;
  updatedAt?: string;
  createdAt?: string;
};

const API = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || "Something went wrong.");
  }

  return data as T;
}

function getConversationId(item: Record<string, unknown>): string {
  return String(item._id ?? item.id ?? item.conversationId ?? "");
}

function App() {
  const [mode, setMode] = useState<Mode>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [language, setLanguage] = useState("JavaScript");
  const [code, setCode] = useState("");
  const [errorText, setErrorText] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadConversations = useCallback(async () => {
    setHistoryLoading(true);

    try {
      const data = await request<unknown>("/conversations");
      const items = Array.isArray(data)
        ? data
        : (data as { conversations?: unknown[] }).conversations ?? [];

      const parsed = (items as Record<string, unknown>[])
        .map((item) => ({
          id: getConversationId(item),
          title: String(item.title ?? "Untitled conversation"),
          messageCount: Number(item.messageCount ?? 0),
          updatedAt: String(item.updatedAt ?? ""),
          createdAt: String(item.createdAt ?? ""),
        }))
        .filter((item) => item.id)
        .slice(0, 50);

      setConversations(parsed);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not load chat history: ${err.message}`
          : "Could not load chat history.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  async function openConversation(id: string) {
    setMode("chat");
    setConversationId(id);
    setMessages([]);
    setMessage("");
    setResult("");
    setError("");
    setLoading(true);

    try {
      const data = await request<Record<string, unknown>>(
        `/conversations/${encodeURIComponent(id)}`,
      );

      const conversation = (
        data.conversation && typeof data.conversation === "object"
          ? data.conversation
          : data
      ) as Record<string, unknown>;

      const rawMessages =
        (conversation.messages as Record<string, unknown>[] | undefined) ??
        (data.messages as Record<string, unknown>[] | undefined) ??
        [];

      setMessages(
        rawMessages.map((item) => ({
          role:
            item.role === "user" || item.role === "human"
              ? "user"
              : "assistant",
          content: String(
            item.content ?? item.message ?? item.text ?? "",
          ),
        })),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not open conversation.",
      );
    } finally {
      setLoading(false);
    }
  }

  function startNewChat() {
    setMode("chat");
    setConversationId("");
    setMessages([]);
    setMessage("");
    setResult("");
    setError("");
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = message.trim();
    if (!text || loading) return;

    setError("");
    setMessage("");
    setMessages((previous) => [
      ...previous,
      { role: "user", content: text },
    ]);
    setLoading(true);

    try {
      const data = await request<{
        conversationId: string;
        reply: string;
        model?: string;
      }>("/chat", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          ...(conversationId ? { conversationId } : {}),
        }),
      });

      setConversationId(data.conversationId);
      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: data.reply },
      ]);

      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runCodeTool(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!code.trim() || loading) {
      setError("Please enter some code first.");
      return;
    }

    setError("");
    setResult("");
    setLoading(true);

    try {
      if (mode === "debug") {
        const data = await request<{
          analysis: string;
        }>("/debug", {
          method: "POST",
          body: JSON.stringify({
            language,
            code,
            ...(errorText.trim() ? { error: errorText.trim() } : {}),
          }),
        });

        setResult(data.analysis);
      } else {
        const data = await request<{ review: string }>("/review", {
          method: "POST",
          body: JSON.stringify({ language, code }),
        });

        setResult(data.review);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  const activeTitle =
    mode === "chat"
      ? "AI Chat"
      : mode === "debug"
        ? "Code Debugger"
        : "Code Review";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">&lt;/&gt;</div>
          <div>
            <h1>DevMate AI</h1>
            <p>Developer workspace</p>
          </div>
        </div>

        <button className="new-chat-button" onClick={startNewChat}>
          <span>＋</span> New conversation
        </button>

        <p className="sidebar-label">WORKSPACE</p>

        <nav className="nav-list">
          <button
            className={`nav-item ${mode === "chat" ? "active" : ""}`}
            onClick={() => {
              setMode("chat");
              setError("");
              setResult("");
            }}
          >
            <span className="nav-icon">◈</span> AI Chat
          </button>
          <button
            className={`nav-item ${mode === "debug" ? "active" : ""}`}
            onClick={() => {
              setMode("debug");
              setError("");
              setResult("");
            }}
          >
            <span className="nav-icon">⌘</span> Code Debugger
          </button>
          <button
            className={`nav-item ${mode === "review" ? "active" : ""}`}
            onClick={() => {
              setMode("review");
              setError("");
              setResult("");
            }}
          >
            <span className="nav-icon">✓</span> Code Review
          </button>
        </nav>

        <div className="history-heading">
          <p className="sidebar-label">RECENT CONVERSATIONS</p>
          <button
            className="refresh-button"
            title="Refresh history"
            onClick={() => void loadConversations()}
          >
            ↻
          </button>
        </div>

        <div className="conversation-list">
          {historyLoading && (
            <p className="muted small">Loading history...</p>
          )}

          {!historyLoading && conversations.length === 0 && (
            <p className="muted small">Your conversations will appear here.</p>
          )}

          {conversations.map((item) => (
            <button
              key={item.id}
              className={`conversation-item ${
                conversationId === item.id && mode === "chat"
                  ? "selected"
                  : ""
              }`}
              onClick={() => void openConversation(item.id)}
              title={item.title}
            >
              <span className="conversation-icon">▤</span>
              <span className="conversation-title">{item.title}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="avatar">DM</div>
          <div>
            <strong>Developer</strong>
            <p>Personal workspace</p>
          </div>
          <span className="online-dot" title="Local workspace" />
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <div className="breadcrumb">Workspace / {activeTitle}</div>
            <h2>{activeTitle}</h2>
          </div>
          <div className="status-pill">
            <span className="status-dot" />
            AI workspace
          </div>
        </header>

        <section className="workspace">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")}>×</button>
            </div>
          )}

          {mode === "chat" && (
            <div className="chat-layout">
              <div className="chat-intro">
                <div className="hero-icon">✳</div>
                <h3>
                  {messages.length ? "Your coding conversation" : "Build something great."}
                </h3>
                <p>
                  Ask questions, explore ideas, and solve coding problems
                  with your AI development assistant.
                </p>
              </div>

              <div className="messages">
                {messages.map((item, index) => (
                  <div
                    className={`message-row ${item.role}`}
                    key={`${index}-${item.role}`}
                  >
                    <div className={`message-avatar ${item.role}`}>
                      {item.role === "user" ? "Y" : "AI"}
                    </div>
                    <div className="message-content">
                      <span className="message-author">
                        {item.role === "user" ? "You" : "DevMate AI"}
                      </span>
                      <div className="message-bubble">{item.content}</div>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="loading-text">
                    <span className="loading-dot" />
                    DevMate AI is thinking...
                  </div>
                )}

                <div />
              </div>

              <div className="composer-wrap">
                {!messages.length && (
                  <div className="suggestions">
                    {[
                      "Explain REST APIs",
                      "Help me with React",
                      "How does JWT authentication work?",
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setMessage(suggestion)}
                      >
                        {suggestion} <span>↗</span>
                      </button>
                    ))}
                  </div>
                )}

                <form className="composer" onSubmit={sendMessage}>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Ask DevMate anything about development..."
                    rows={2}
                    disabled={loading}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="composer-bottom">
                    <span>Enter to send · Shift + Enter for new line</span>
                    <button
                      className="primary-button send-button"
                      type="submit"
                      disabled={loading || !message.trim()}
                    >
                      {loading ? "Sending..." : "Send ↑"}
                    </button>
                  </div>
                </form>
                <p className="disclaimer">
                  AI responses may contain mistakes. Verify critical code before use.
                </p>
              </div>
            </div>
          )}

          {(mode === "debug" || mode === "review") && (
            <div className="tool-layout">
              <div className="tool-heading">
                <div className={`tool-icon ${mode}`}>
                  {mode === "debug" ? "⌘" : "✓"}
                </div>
                <div>
                  <h3>
                    {mode === "debug"
                      ? "Find and fix code issues"
                      : "Improve your code quality"}
                  </h3>
                  <p>
                    {mode === "debug"
                      ? "Share your code and optional error message for an AI-powered diagnosis."
                      : "Get feedback on bugs, security, performance, readability, and best practices."}
                  </p>
                </div>
              </div>

              <form className="tool-form" onSubmit={runCodeTool}>
                <div className="field">
                  <label htmlFor="language">Programming language</label>
                  <select
                    id="language"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                  >
                    {[
                      "JavaScript",
                      "TypeScript",
                      "Python",
                      "Java",
                      "C",
                      "C++",
                      "C#",
                      "PHP",
                      "Go",
                      "Rust",
                      "SQL",
                    ].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>

                {mode === "debug" && (
                  <div className="field">
                    <label htmlFor="errorText">
                      Error message <span className="optional">(optional)</span>
                    </label>
                    <textarea
                      id="errorText"
                      value={errorText}
                      onChange={(event) => setErrorText(event.target.value)}
                      placeholder="Paste the error or stack trace here..."
                      rows={3}
                    />
                  </div>
                )}

                <div className="field">
                  <label htmlFor="code">Your code</label>
                  <textarea
                    id="code"
                    className="code-editor"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder={`// Paste your ${language} code here...`}
                    rows={12}
                    spellCheck={false}
                    required
                  />
                </div>

                <div className="tool-form-bottom">
                  <span className="muted small">
                    Your code is sent to your configured AI backend.
                  </span>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={loading || !code.trim()}
                  >
                    {loading
                      ? "Analyzing..."
                      : mode === "debug"
                        ? "Debug code →"
                        : "Review code →"}
                  </button>
                </div>
              </form>

              {loading && (
                <div className="result-card">
                  <div className="loading-text">
                    <span className="loading-dot" />
                    {mode === "debug"
                      ? "Analyzing the error..."
                      : "Reviewing your code..."}
                  </div>
                </div>
              )}

              {result && !loading && (
                <div className="result-card">
                  <div className="result-heading">
                    <div>
                      <span className="result-kicker">AI ANALYSIS</span>
                      <h3>
                        {mode === "debug" ? "Debug results" : "Code review results"}
                      </h3>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => void navigator.clipboard.writeText(result)}
                    >
                      Copy result
                    </button>
                  </div>
                  <pre className="result-content">{result}</pre>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
