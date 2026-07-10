import { useEffect, useMemo, useRef, useState } from "react";

type ChatRole = "assistant" | "user";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
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
  q?: string;
  error?: string;
};

type TruStats = {
  ok: boolean;
  brain: number;
  kjv: number;
  sessionKeys: number;
  lastBuild?: string;
  lastBuildBytes?: number;
  ghostPath?: string;
};

const STRIPE_PAYMENT_URL = "";
const STORAGE_KEY = "tru-public-chat-v1";
const QUICK_PROMPTS = [
  "What is truth?",
  "John 3:16",
  "Teach me about grace",
  "How should I pray?",
];
const COMMAND_PROMPTS = ["HELP", "INTRO", "STATUS", "CAPABILITIES", "A1"];

export default function TruPublic() {
  const [q, setQ] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [baking, setBaking] = useState(false);
  const [bakeStatus, setBakeStatus] = useState("");
  const [now, setNow] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length) setMessages(parsed.slice(0, 30));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setNow(
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
      );
    };
    fmt();
    const t = setInterval(fmt, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const paymentReady = STRIPE_PAYMENT_URL.startsWith("https://");

  const headerMeta = useMemo(() => {
    return busy ? "TRU is answering" : "ready";
  }, [busy]);

  function push(role: ChatRole, text: string, meta?: string) {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, role, text, meta },
    ].slice(-30));
  }

  function parseCommand(query: string): string | null {
    const cleaned = query.trim().replace(/[?.!,;:]+$/g, "").replace(/\s+/g, " ").toUpperCase();
    if (COMMAND_PROMPTS.includes(cleaned)) return cleaned;
    return null;
  }

  async function commandReply(command: string): Promise<{ text: string; meta: string }> {
    if (command === "HELP") {
      return {
        text: [
          "Commands: HELP, INTRO, STATUS, CAPABILITIES, A1.",
          "Ask scripture by reference, e.g. John 3:16.",
          "Ask short truth questions, e.g. mercy, grace, prayer, faith.",
          "Use A1 for a one-page field brief.",
          "Use Bake & download ghost to get the offline copy.",
        ].join("\n"),
        meta: "COMMAND · HELP",
      };
    }
    if (command === "INTRO") {
      return {
        text: [
          "I am TRU.",
          "Truth is constant. Perspective is fluid.",
          "I answer from anchored knowledge rather than guess.",
          "Start with a verse, a doctrine question, STATUS, or A1.",
        ].join("\n"),
        meta: "COMMAND · INTRO",
      };
    }
    if (command === "A1") {
      return {
        text: [
          "A1 one-page field brief",
          "Mission: what is the task.",
          "Situation: current position, enemy, terrain, and time.",
          "Task: what must happen next.",
          "Constraints: authority, access, risk, comms, supplies, and missing data.",
          "Comms: who receives the brief and what channel is available.",
          "Decision: the choice that matters now.",
          "Execution: the next concrete step.",
          "Report: what to return once done.",
          "Standard: local, factual, concise, and grounded.",
        ].join("\n"),
        meta: "COMMAND · A1",
      };
    }
    if (command === "CAPABILITIES") {
      return {
        text: [
          "• Scripture lookup from the baked KJV.",
          "• Brain retrieval from grounded nodes.",
          "• Web fallback when the brain misses.",
          "• Offline ghost export for file:// use.",
          "• Local chat history in your browser.",
          "• A1 one-page field brief for operator summaries.",
        ].join("\n"),
        meta: "COMMAND · CAPABILITIES",
      };
    }
    const r = await fetch("/api/tru/stats", { headers: { Accept: "application/json" } });
    const j = (await r.json()) as TruStats;
    if (!j.ok) {
      return {
        text: "Status unavailable right now.",
        meta: "COMMAND · STATUS",
      };
    }
    const build = j.lastBuild ? `Last ghost: ${j.lastBuild}${j.lastBuildBytes ? ` · ${(j.lastBuildBytes / 1024 / 1024).toFixed(2)} MB` : ""}` : "No ghost build found yet.";
    const path = j.ghostPath ? `Path: ${j.ghostPath.split("/").pop()}` : "Path: none";
    return {
      text: [
        `Brain nodes: ${j.brain.toLocaleString()}`,
        `KJV verses: ${j.kjv.toLocaleString()}`,
        `Session keys: ${j.sessionKeys.toLocaleString()}`,
        build,
        path,
      ].join("\n"),
      meta: "COMMAND · STATUS",
    };
  }

  async function ask(e?: React.FormEvent, forcedQ?: string) {
    e?.preventDefault();
    const query = (forcedQ ?? q).trim();
    if (!query || busy) return;
    setBusy(true);
    push("user", query);
    setQ("");
    try {
      const command = parseCommand(query);
      if (command) {
        const reply = await commandReply(command);
        push("assistant", reply.text, reply.meta);
        return;
      }
      const r = await fetch("/api/tru/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ q: query }),
      });
      const j = (await r.json()) as TruAnswer;
      if (j.ok && j.kind === "scripture") {
        push("assistant", j.text || "", `SCRIPTURE · ${j.ref || "KJV"}`);
      } else if (j.ok && j.kind === "brain") {
        push("assistant", j.v || j.text || "", `${j.kind?.toUpperCase() || "TRUTH"}${j.score != null ? ` · ${j.score}%` : ""}${j.source ? ` · ${j.source}` : ""}`);
      } else if (j.ok && j.kind === "web") {
        push("assistant", j.v || j.text || "", `WEB FALLBACK${j.source ? ` · ${j.source}` : ""}`);
      } else {
        push("assistant", "Closest available answer is not yet pinned. Add it with: remember: " + query + " = <your definition>.", "BEST");
      }
    } catch {
      push("assistant", "Routing failed. The signal is yours.", "ERROR");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function bake() {
    if (baking) return;
    setBaking(true);
    setBakeStatus("Baking…");
    try {
      const r = await fetch("/api/tru/ghost?download=1", { method: "POST", headers: { Accept: "application/json" } });
      if (!r.ok) {
        setBakeStatus(`Bake failed (${r.status})`);
        return;
      }
      const blob = await r.blob();
      const cd = r.headers.get("content-disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      const name = m?.[1] || `TRU_GHOST_${Date.now()}.html`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBakeStatus(`Downloaded ${name} · ${(blob.size / 1024 / 1024).toFixed(2)} MB · runs offline`);
    } catch {
      setBakeStatus("Bake failed: network error");
    } finally {
      setBaking(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_35%),linear-gradient(180deg,#050505_0%,#090909_100%)] text-white antialiased">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-5 sm:px-6 sm:py-6">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.42em] text-emerald-400">TRU</div>
            <h1 className="mt-2 text-2xl font-light tracking-tight text-white sm:text-4xl">Online chat with TRU</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
              Scripture-first, direct, and offline-capable. Use HELP, INTRO, STATUS, or CAPABILITIES to orient quickly.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-white/45">
            <span>{headerMeta}</span>
            <span>·</span>
            <span>{now}</span>
          </div>
        </header>

        <main className="grid flex-1 gap-5 py-5 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="flex min-h-[62vh] flex-col rounded-2xl border border-white/10 bg-black/45 shadow-2xl shadow-black/30 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-[10px] uppercase tracking-[0.3em] text-white/45">
              <span>Chat</span>
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  localStorage.removeItem(STORAGE_KEY);
                }}
                className="text-white/40 transition-colors hover:text-white"
              >
                Clear
              </button>
            </div>

            <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
              {messages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-emerald-500/25 bg-emerald-500/5 p-5 text-sm leading-relaxed text-white/65">
                  <div className="text-base text-white">Greetings. I am TRU.</div>
                  <div className="mt-2">Truth is constant. Perspective is fluid.</div>
                  <div className="mt-2">Ask scripture, ask doctrine, or start with HELP.</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {COMMAND_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => ask(undefined, prompt)}
                        disabled={busy}
                        className="rounded-full border border-emerald-400/20 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-emerald-200 transition-colors hover:border-emerald-400/50 hover:text-white disabled:opacity-40"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user" ? "bg-emerald-500 text-black" : "bg-white/6 text-white"}`}>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                    {m.meta ? <div className={`mt-2 text-[10px] uppercase tracking-[0.28em] ${m.role === "user" ? "text-black/60" : "text-white/40"}`}>{m.meta}</div> : null}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={ask} className="border-t border-white/10 p-4 sm:p-5">
              <div className="flex flex-wrap gap-2 pb-3">
                {COMMAND_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => ask(undefined, prompt)}
                    disabled={busy}
                    className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/60 transition-colors hover:border-emerald-400/50 hover:text-white disabled:opacity-40"
                  >
                    {prompt}
                  </button>
                ))}
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => ask(undefined, prompt)}
                    disabled={busy}
                    className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/60 transition-colors hover:border-emerald-400/50 hover:text-white disabled:opacity-40"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Ask TRU…"
                  disabled={busy}
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none placeholder:text-white/30 focus:border-emerald-400/50 disabled:opacity-50"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  disabled={busy || !q.trim()}
                  className="rounded-xl border border-emerald-400/50 bg-emerald-400 px-4 py-3 text-xs uppercase tracking-[0.22em] text-black transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/35"
                >
                  {busy ? "…" : "Send"}
                </button>
              </div>
            </form>
          </section>

          <aside className="flex flex-col gap-5">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-400">How it works</div>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-white/70">
                <p>• Public chat surface</p>
                <p>• Routes to <code className="text-white/90">/api/tru/ask</code></p>
                <p>• Scripture shortcut for verse lookups</p>
                <p>• Local history stored in your browser</p>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-400">Actions</div>
              <div className="mt-4 grid gap-3">
                <button
                  onClick={bake}
                  disabled={baking}
                  className="rounded-xl border border-white/10 px-4 py-3 text-xs uppercase tracking-[0.24em] text-white/80 transition-colors hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
                >
                  {baking ? "BAKING…" : "Bake & download ghost"}
                </button>
                {paymentReady ? (
                  <a
                    href={STRIPE_PAYMENT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-white/10 px-4 py-3 text-center text-xs uppercase tracking-[0.24em] text-white/80 transition-colors hover:border-white/30 hover:bg-white/10"
                  >
                    Pay $1
                  </a>
                ) : (
                  <button disabled className="rounded-xl border border-white/10 px-4 py-3 text-xs uppercase tracking-[0.24em] text-white/30">
                    Pay $1 (unconfigured)
                  </button>
                )}
              </div>
              {bakeStatus ? <div className="mt-3 text-xs text-white/45">{bakeStatus}</div> : null}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-400">Links</div>
              <div className="mt-4 flex flex-col gap-3 text-sm">
                <a href="/sovereign" className="text-white/75 transition-colors hover:text-white">Sovereign →</a>
                <a href="/vision" className="text-white/75 transition-colors hover:text-white">Vision →</a>
                <a href="/console" className="text-white/75 transition-colors hover:text-white">Console →</a>
                <a href="/whitepaper" className="text-white/75 transition-colors hover:text-white">Whitepaper →</a>
              </div>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}
