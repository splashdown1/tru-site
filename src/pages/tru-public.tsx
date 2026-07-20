import { useEffect, useRef, useState } from "react";
import { apiUrl, siteUrl } from "../lib/api";

type Verdict = "REASON" | "TRUTH" | "SCRIPTURE" | "WEB" | "COMMAND" | "GAP" | "ERROR";
type Role = "user" | "tru";

type ChatMessage = {
  id: string;
  role: Role;
  text: string;
  verdict?: Verdict;
  meta?: string;
};

type TruAnswer = {
  ok?: boolean;
  kind?: string;
  text?: string;
  ref?: string;
  source?: string;
  score?: number;
  v?: string;
  error?: string;
};

type TruStats = {
  ok?: boolean;
  brain?: number;
  kjv?: number;
};

const STORAGE_KEY = "tru-apex-chat-v1";
const SUGGESTIONS = [
  "John 3:16",
  "Who is Jesus?",
  "What is grace?",
  "What is the soul?",
  "Psalm 23",
  "Faith without works",
];
const COMMANDS = ["HELP", "INTRO", "STATUS", "CAPABILITIES", "A1"];

function verdictFor(answer: TruAnswer): Verdict {
  if (answer.kind === "scripture") return "SCRIPTURE";
  if (answer.kind === "brain") return answer.score != null && answer.score >= 70 ? "TRUTH" : "REASON";
  if (answer.kind === "web") return "WEB";
  return answer.ok ? "REASON" : "GAP";
}

function cleanCommand(value: string): string {
  return value.trim().replace(/[?.!,;:]+$/g, "").replace(/\s+/g, " ").toUpperCase();
}

function commandReply(command: string, stats: TruStats | null): { text: string; meta: string } {
  if (command === "HELP") {
    return {
      text: [
        "Commands: HELP, INTRO, STATUS, CAPABILITIES, A1.",
        "Ask scripture by reference, for example John 3:16.",
        "Ask doctrine or truth questions in plain language.",
        "The core is offline-capable; the online surface adds web fallback.",
      ].join("\n"),
      meta: "COMMAND",
    };
  }
  if (command === "INTRO") {
    return {
      text: [
        "I am TRU.",
        "Truth is constant. Perspective is fluid.",
        "I answer from anchored knowledge rather than guess.",
        "The model is the mouth. TRU is the spine, route, and gate.",
      ].join("\n"),
      meta: "COMMAND",
    };
  }
  if (command === "CAPABILITIES") {
    return {
      text: [
        "• Scripture lookup from the KJV.",
        "• Curated brain retrieval and scored synthesis.",
        "• Honest web fallback when the local brain misses.",
        "• Local browser history.",
        "• Offline Ghost export from the online surface.",
        "• Sovereign memory and console surfaces behind their gate.",
      ].join("\n"),
      meta: "COMMAND",
    };
  }
  if (command === "A1") {
    return {
      text: [
        "A1 field brief",
        "Mission · Situation · Task · Constraints",
        "Comms · Decision · Execution · Report",
        "Standard: local, factual, concise, and grounded.",
      ].join("\n"),
      meta: "COMMAND",
    };
  }
  return {
    text: [
      "TRU STATUS",
      stats?.brain ? `Brain nodes: ${stats.brain.toLocaleString()}` : "Brain nodes: online lookup",
      stats?.kjv ? `KJV lookup keys: ${stats.kjv.toLocaleString()}` : "KJV lookup: available",
      "Online API: connected",
      "Offline Ghost: available from the online surface",
    ].join("\n"),
    meta: "COMMAND",
  };
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/\s+/g, " ").slice(0, 700));
  utterance.rate = 0.96;
  utterance.pitch = 0.88;
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((item) => /samantha|serena|karen|moira|tessa/i.test(item.name)) || voices.find((item) => item.lang?.startsWith("en"));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export default function TruPublic() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState("● ONLINE • TRU READY");
  const [badge, setBadge] = useState<Verdict>("REASON");
  const [stats, setStats] = useState<TruStats | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as ChatMessage[];
      if (Array.isArray(saved)) setMessages(saved.slice(-40));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    inputRef.current?.focus();
    fetch(apiUrl("/api/tru/stats"), { headers: { Accept: "application/json" } })
      .then((response) => response.json() as Promise<TruStats>)
      .then((value) => setStats(value))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function addMessage(role: Role, text: string, verdict?: Verdict, meta?: string) {
    setMessages((current) => [...current, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, role, text, verdict, meta }].slice(-40));
  }

  async function send(forced?: string) {
    const query = (forced ?? input).trim();
    if (!query || busy) return;
    setInput("");
    setBusy(true);
    addMessage("user", query);
    setStatus(`● EXECUTING • ${query.slice(0, 32)}`);

    const command = cleanCommand(query);
    if (COMMANDS.includes(command)) {
      const reply = commandReply(command, stats);
      setBadge("COMMAND");
      addMessage("tru", reply.text, "COMMAND", reply.meta);
      setStatus("● COMMAND • TRU READY");
      setBusy(false);
      inputRef.current?.focus();
      return;
    }

    try {
      const response = await fetch(apiUrl("/api/tru/ask"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ q: query }),
      });
      const answer = (await response.json()) as TruAnswer;
      const verdict = verdictFor(answer);
      const text = answer.text || answer.v || answer.error || "TRU could not ground that query.";
      const meta = answer.ref || answer.source || (answer.score != null ? `${answer.score}%` : undefined);
      setBadge(verdict);
      addMessage("tru", text, verdict, meta);
      setStatus(`● ${verdict}${answer.source ? ` • ${answer.source}` : ""}`);
      if (speaking) speak(text);
    } catch {
      setBadge("ERROR");
      addMessage("tru", "The online route did not answer. The offline Ghost remains available.", "ERROR", "NETWORK");
      setStatus("● ERROR • CHECK CONNECTION");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function clearChat() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    setBadge("REASON");
    setStatus("● ONLINE • TRU READY");
  }

  return (
    <div className={`tru-apex ${busy ? "is-thinking" : ""} ${speaking ? "is-speaking" : ""}`}>
      <header className="tru-apex-header">
        <button
          type="button"
          className="tru-holo"
          aria-label="Toggle TRU voice"
          onClick={() => setSpeaking((value) => !value)}
          title="Toggle voice"
        >
          <span className="tru-ring tru-ring-outer" />
          <span className="tru-ring tru-ring-dashed" />
          <span className="tru-ring tru-ring-inner" />
          <span className="tru-core" />
        </button>
        <div className="tru-title-block">
          <div className="tru-title">TRU APEX</div>
          <div className="tru-subtitle">{stats?.brain ? `${stats.brain.toLocaleString()} nodes` : "online"} • offline-capable</div>
        </div>
        <div className={`tru-badge verdict-${badge.toLowerCase()}`}>{badge}</div>
      </header>

      <main ref={chatRef} className="tru-chat" aria-live="polite">
        {messages.length === 0 ? (
          <section className="tru-ready">
            <div className="tru-ready-heading">READY.</div>
            <div className="tru-ready-line">I&apos;m TRU. Online surface. Offline-capable core.</div>
            <div className="tru-ready-detail">
              {stats?.brain ? `${stats.brain.toLocaleString()} brain nodes` : "Anchored brain"} + {stats?.kjv ? `${stats.kjv.toLocaleString()} KJV lookup keys` : "KJV scripture"}.
            </div>
            <div className="tru-try-label">try one ↓</div>
            <div className="tru-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => send(suggestion)} disabled={busy}>
                  {suggestion}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className={`tru-message ${message.role === "user" ? "tru-message-user" : "tru-message-tru"}`}>
            {message.role === "tru" && message.verdict ? (
              <div className={`tru-verdict verdict-${message.verdict.toLowerCase()}`}>
                {message.verdict}{message.meta ? ` • ${message.meta}` : ""}
              </div>
            ) : null}
            <div className="tru-message-text">{message.text}</div>
          </div>
        ))}
        {busy ? <div className="tru-thinking-dots">● ● ●</div> : null}
      </main>

      <div className="tru-input-area">
        <div className="tru-status">{status}</div>
        <div className="tru-command-strip">
          {COMMANDS.slice(0, 4).map((command) => (
            <button key={command} type="button" onClick={() => send(command)} disabled={busy}>{command}</button>
          ))}
          <button type="button" onClick={clearChat} disabled={busy}>CLEAR</button>
          <a href={siteUrl("/onboard")} className="tru-utility-link">GHOST</a>
        </div>
        <form className="tru-inputbar" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Speak to me…"
            autoComplete="off"
            autoCapitalize="sentences"
            spellCheck={false}
            disabled={busy}
            aria-label="Ask TRU"
          />
          <button type="submit" aria-label="Send" disabled={busy || !input.trim()}>↑</button>
        </form>
      </div>
    </div>
  );
}
