
import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";

type Mode = "chat" | "debug" | "review";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  id: string;
  title: string;
  mode: Mode;
  messageCount?: number;
  updatedAt?: string;
  createdAt?: string;
};

type FixResult = {
  success: boolean;
  language: string;
  originalCode: string;
  fixedCode: string;
  explanation: string;
  changes: string[];
  model?: string;
};

const API =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV
    ? "/api"
    : "https://devmate-ai-vmux.onrender.com/api");

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API}${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  } catch {
    throw new Error(
      "Unable to connect to DevMate AI server. Please check your internet connection or try again later."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorData = data as { error?: string; message?: string };

    if (response.status === 429) {
      throw new Error(
        errorData.error || "AI usage limit reached. Please try again later."
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        errorData.error || "AI API authentication failed."
      );
    }

    if (response.status >= 500) {
      throw new Error(
        errorData.error || "AI service is temporarily unavailable."
      );
    }

    throw new Error(
      errorData.error || errorData.message || "Something went wrong."
    );
  }

  return data as T;
}

function getConversationId(
  item: Record<string, unknown>
): string {
  return String(
    item._id ?? item.id ?? item.conversationId ?? ""
  );
}

function getMode(
  value: unknown,
  title: string
): Mode {
  if (value === "debug" || title.startsWith("[Debugger]")) {
    return "debug";
  }

  if (value === "review" || title.startsWith("[Code Review]")) {
    return "review";
  }

  return "chat";
}

function App() {
  const [mode, setMode] = useState<Mode>("chat");

  const editorRef =
    useRef<editor.IStandaloneCodeEditor | null>(null);

  const [conversations, setConversations] =
    useState<Conversation[]>([]);

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
  const [historySearch, setHistorySearch] = useState("");
const [deletingId, setDeletingId] = useState("");

  const [fixResult, setFixResult] =
    useState<FixResult | null>(null);

  const [fixLoading, setFixLoading] = useState(false);

 
const loadConversations = useCallback(async () => {
  setHistoryLoading(true);

  try {
    const query = historySearch.trim()
      ? `?search=${encodeURIComponent(historySearch.trim())}`
      : "";

    const data = await request<{
      conversations?: Record<string, unknown>[];
    }>(`/conversations${query}`);

    const items = data.conversations ?? [];

    const parsed: Conversation[] = items
      .map((item) => {
        const title = String(
          item.title ?? "Untitled conversation"
        );

        return {
          id: getConversationId(item),
          title,
          mode: getMode(item.mode, title),
          messageCount: Number(item.messageCount ?? 0),
          updatedAt: String(item.updatedAt ?? ""),
          createdAt: String(item.createdAt ?? ""),
        };
      })
      .filter((item) => item.id)
      .slice(0, 50);

    setConversations(parsed);
  } catch (err) {
    setError(
      err instanceof Error
        ? `Could not load chat history: ${err.message}`
        : "Could not load chat history."
    );
  } finally {
    setHistoryLoading(false);
  }
}, [historySearch]);


async function deleteConversation(id: string) {
  const confirmed = window.confirm(
    "Are you sure you want to permanently delete this conversation?"
  );

  if (!confirmed || deletingId) return;

  setDeletingId(id);
  setError("");

  try {
    await request<{
      success: boolean;
      message: string;
    }>(`/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    setConversations((previous) =>
      previous.filter((item) => item.id !== id)
    );

    if (conversationId === id) {
      startNewChat();
    }
  } catch (err) {
    setError(
      err instanceof Error
        ? `Could not delete conversation: ${err.message}`
        : "Could not delete conversation."
    );
  } finally {
    setDeletingId("");
  }
}

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  async function openConversation(id: string) {
    setConversationId(id);
    setMessages([]);
    setMessage("");
    setResult("");
    setCode("");
    setErrorText("");
    setFixResult(null);
    setError("");
    setLoading(true);

    try {
      const data = await request<Record<string, unknown>>(
        `/conversations/${encodeURIComponent(id)}`
      );

      const title = String(data.title ?? "");

      const selectedMode = getMode(data.mode, title);

      setMode(selectedMode);

      const rawMessages =
        (data.messages as Record<string, unknown>[] | undefined) ?? [];

      const userMessage = rawMessages.find(
        (item) => item.role === "user"
      );

      const assistantMessage = [...rawMessages]
        .reverse()
        .find((item) => item.role === "assistant");

      if (selectedMode === "chat") {
        setMessages(
          rawMessages.map((item) => ({
            role:
              item.role === "user" || item.role === "human"
                ? "user"
                : "assistant",
            content: String(item.content ?? ""),
          }))
        );
      } else {
        const userContent = String(userMessage?.content ?? "");
        const assistantContent = String(
          assistantMessage?.content ?? ""
        );

        const languageMatch = userContent.match(
          /^Language:\s*(.+)$/m
        );

        if (languageMatch) {
          setLanguage(languageMatch[1].trim());
        }

        if (selectedMode === "debug") {
          const errorMatch = userContent.match(
            /\n\nError:\n([\s\S]*?)(?=\n\nOriginal Code:\n)/
          );

          const codeMatch = userContent.match(
            /\n\nOriginal Code:\n([\s\S]*)$/
          );

          const savedError = errorMatch?.[1]?.trim() ?? "";

          setErrorText(
            savedError === "No error message provided."
              ? ""
              : savedError
          );

          setCode(codeMatch?.[1] ?? "");
        } else {
          const codeMatch = userContent.match(
            /\n\nCode Submitted for Review:\n([\s\S]*)$/
          );

          setCode(codeMatch?.[1] ?? "");
        }

        setResult(assistantContent);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not open conversation."
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
    setCode("");
    setErrorText("");
    setResult("");
    setFixResult(null);
    setError("");
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setConversationId("");
    setMessages([]);
    setMessage("");
    setCode("");
    setErrorText("");
    setResult("");
    setFixResult(null);
    setError("");
  }

  async function sendMessage(
    event: React.FormEvent<HTMLFormElement>
  ) {
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
      setError(
        err instanceof Error ? err.message : "Message failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runCodeTool(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!code.trim() || loading) {
      setError("Please enter some code first.");
      return;
    }

    setError("");
    setResult("");
    setFixResult(null);
    setLoading(true);

    try {
      if (mode === "debug") {
        const data = await request<{
          conversationId: string;
          analysis: string;
        }>("/debug", {
          method: "POST",
          body: JSON.stringify({
            language,
            code,
            ...(errorText.trim()
              ? { error: errorText.trim() }
              : {}),
          }),
        });

        setConversationId(data.conversationId);
        setResult(data.analysis);
      } else {
        const data = await request<{
          conversationId: string;
          review: string;
        }>("/review", {
          method: "POST",
          body: JSON.stringify({
            language,
            code,
          }),
        });

        setConversationId(data.conversationId);
        setResult(data.review);
      }

      await loadConversations();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Request failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function generateFix() {
    if (!code.trim() || fixLoading) {
      setError("Please enter some code first.");
      return;
    }

    setError("");
    setFixResult(null);
    setFixLoading(true);

    try {
      const data = await request<FixResult>("/fix-code", {
        method: "POST",
        body: JSON.stringify({
          language,
          code,
          ...(errorText.trim()
            ? { error: errorText.trim() }
            : {}),
        }),
      });

      setFixResult(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not generate fixed code."
      );
    } finally {
      setFixLoading(false);
    }
  }

  function formatCode() {
    void editorRef.current
      ?.getAction("editor.action.formatDocument")
      ?.run();
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setError("");
    } catch {
      setError(
        "Could not copy code. Please check clipboard permissions."
      );
    }
  }

  function clearCode() {
    setCode("");
    setResult("");
    setFixResult(null);
    setError("");
  }

  function downloadFixedCode() {
    if (!fixResult) return;

    const extension =
      language.toLowerCase().replace(/[^a-z0-9]/g, "") || "txt";

    const blob = new Blob([fixResult.fixedCode], {
      type: "text/plain",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `fixed-code.${extension}.txt`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
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

        <button
          className="new-chat-button"
          onClick={startNewChat}
        >
          <span>＋</span> New conversation
        </button>

        <p className="sidebar-label">WORKSPACE</p>

        <nav className="nav-list">
          <button
            className={`nav-item ${mode === "chat" ? "active" : ""}`}
            onClick={() => changeMode("chat")}
          >
            <span className="nav-icon">◈</span> AI Chat
          </button>

          <button
            className={`nav-item ${mode === "debug" ? "active" : ""}`}
            onClick={() => changeMode("debug")}
          >
            <span className="nav-icon">⌘</span> Code Debugger
          </button>

          <button
            className={`nav-item ${mode === "review" ? "active" : ""}`}
            onClick={() => changeMode("review")}
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

<div className="history-search">
  <input
    type="search"
    value={historySearch}
    onChange={(event) => setHistorySearch(event.target.value)}
    placeholder="Search conversations..."
    aria-label="Search conversations"
  />
  {historySearch && (
    <button
      type="button"
      onClick={() => setHistorySearch("")}
      title="Clear search"
    >
      ×
    </button>
  )}
</div>

        
<div className="conversation-list">
  {historyLoading && (
    <p className="muted small">Loading history...</p>
  )}

  {!historyLoading && conversations.length === 0 && (
    <p className="muted small">
      {historySearch.trim()
        ? "No matching conversations found."
        : "Your conversations will appear here."}
    </p>
  )}

  {conversations.map((item) => (
    <div
      key={item.id}
      className={`conversation-item ${
        conversationId === item.id ? "selected" : ""
      }`}
    >
      <button
        type="button"
        className="conversation-open-button"
        onClick={() => void openConversation(item.id)}
        title={item.title}
      >
        <span className="conversation-icon">
          {item.mode === "debug"
            ? "⌘"
            : item.mode === "review"
              ? "✓"
              : "▤"}
        </span>

        <span className="conversation-title">
          {item.title}
        </span>
      </button>

      <button
        type="button"
        className="conversation-delete-button"
        onClick={() => void deleteConversation(item.id)}
        disabled={deletingId === item.id}
        title="Delete conversation"
        aria-label={`Delete ${item.title}`}
      >
        {deletingId === item.id ? "..." : "×"}
      </button>
    </div>
  ))}
</div>


        <div className="sidebar-footer">
          <div className="avatar">DM</div>
          <div>
            <strong>Developer</strong>
            <p>Personal workspace</p>
          </div>
          <span
            className="online-dot"
            title="Local workspace"
          />
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <div className="breadcrumb">
              Workspace / {activeTitle}
            </div>
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
                  {messages.length
                    ? "Your coding conversation"
                    : "Build something great."}
                </h3>

                <p>
                  Ask questions, explore ideas, and solve coding
                  problems with your AI development assistant.
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

                      <div className="message-bubble">
                        {item.content}
                      </div>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="loading-text">
                    <span className="loading-dot" />
                    DevMate AI is thinking...
                  </div>
                )}
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

                <form
                  className="composer"
                  onSubmit={sendMessage}
                >
                  <textarea
                    value={message}
                    onChange={(event) =>
                      setMessage(event.target.value)
                    }
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
                    <span>
                      Enter to send · Shift + Enter for new line
                    </span>

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
                  AI responses may contain mistakes. Verify critical
                  code before use.
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

              <form
                className="tool-form"
                onSubmit={runCodeTool}
              >
                <div className="field">
                  <label htmlFor="language">
                    Programming language
                  </label>

                  <select
                    id="language"
                    value={language}
                    onChange={(event) =>
                      setLanguage(event.target.value)
                    }
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
                      Error message{" "}
                      <span className="optional">(optional)</span>
                    </label>

                    <textarea
                      id="errorText"
                      value={errorText}
                      onChange={(event) =>
                        setErrorText(event.target.value)
                      }
                      placeholder="Paste the error or stack trace here..."
                      rows={3}
                    />
                  </div>
                )}

                <div className="field">
                  <label htmlFor="code">
                    Your code
                  </label>

                  <div className="editor-toolbar">
                    <span>Code Editor</span>

                    <div className="editor-toolbar-actions">
                      <button
                        type="button"
                        onClick={formatCode}
                      >
                        Format Code
                      </button>

                      <button
                        type="button"
                        onClick={() => void copyCode()}
                      >
                        Copy Code
                      </button>

                      <button
                        type="button"
                        onClick={clearCode}
                      >
                        Clear Code
                      </button>
                    </div>
                  </div>

                  <Editor
                    height="350px"
                    language={
                      language === "C++"
                        ? "cpp"
                        : language === "C#"
                          ? "csharp"
                          : language === "JavaScript"
                            ? "javascript"
                            : language.toLowerCase()
                    }
                    theme="vs-dark"
                    value={code}
                    onChange={(value) => setCode(value ?? "")}
                    onMount={(editorInstance) => {
                      editorRef.current = editorInstance;
                    }}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: "on",
                      roundedSelection: true,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      wordWrap: "on",
                      suggestOnTriggerCharacters: true,
                      quickSuggestions: true,
                      padding: { top: 16, bottom: 16 },
                    }}
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
                      <span className="result-kicker">
                        AI ANALYSIS
                      </span>

                      <h3>
                        {mode === "debug"
                          ? "Debug results"
                          : "Code review results"}
                      </h3>
                    </div>

                    <button
                      className="secondary-button"
                      onClick={() =>
                        void navigator.clipboard.writeText(result)
                      }
                    >
                      Copy result
                    </button>
                  </div>

                  <pre className="result-content">
                    {result}
                  </pre>
                </div>
              )}

              {mode === "debug" && result && !loading && (
                <div className="result-card">
                  <div className="result-heading">
                    <div>
                      <span className="result-kicker">
                        AI CODE REPAIR
                      </span>

                      <h3>Ready to fix your code?</h3>

                      <p className="muted small">
                        Generate corrected code based on the debugging
                        analysis.
                      </p>
                    </div>

                    <button
                      className="primary-button"
                      onClick={() => void generateFix()}
                      disabled={fixLoading}
                    >
                      {fixLoading
                        ? "Generating fix..."
                        : "Fix My Code →"}
                    </button>
                  </div>
                </div>
              )}

              {fixLoading && (
                <div className="result-card">
                  <div className="loading-text">
                    <span className="loading-dot" />
                    Generating corrected code...
                  </div>
                </div>
              )}

              {fixResult && mode === "debug" && (
                <div className="result-card">
                  <div className="result-heading">
                    <div>
                      <span className="result-kicker">
                        AUTO CODE FIXER
                      </span>

                      <h3>Corrected Code</h3>
                    </div>

                    <button
                      className="secondary-button"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          fixResult.fixedCode
                        )
                      }
                    >
                      Copy Fixed Code
                    </button>
                  </div>

                  <div className="code-comparison">
                    <div className="code-panel">
                      <div className="code-panel-header">
                        Original Code
                        <span>Before</span>
                      </div>

                      <pre>{fixResult.originalCode}</pre>
                    </div>

                    <div className="code-panel">
                      <div className="code-panel-header">
                        Fixed Code
                        <span>AI Generated</span>
                      </div>

                      <pre>{fixResult.fixedCode}</pre>
                    </div>
                  </div>

                  <div className="fix-explanation">
                    <label>AI Explanation</label>
                    <p>{fixResult.explanation}</p>
                  </div>

                  <div className="field">
                    <label>Changes Made</label>

                    <ul className="fix-changes">
                      {fixResult.changes.map((change, index) => (
                        <li key={index}>{change}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="tool-form-bottom">
                    <span className="muted small">
                      Original code remains unchanged.
                    </span>

                    <button
                      className="secondary-button"
                      onClick={downloadFixedCode}
                    >
                      Download Fixed Code ↓
                    </button>
                  </div>
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
