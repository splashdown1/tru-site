import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { askBrain, brain, type BrainResult } from "@/brain";
import { makeExporter } from "@/tru_export";

interface Turn {
  q: string;
  r: BrainResult;
  ts: number;
}

const SUGGESTIONS = [
  "mercy",
  "logos",
  "agape",
  "the golden rule",
  "jesus money",
  "the eye of a needle",
  "what does god require",
];

const PREF_KEY = "tru_prefs_v1";
const TURN_KEY = "tru_turns_v1";
const MAX_TURNS = 50;

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
  } catch {
    return {};
  }
}
function savePrefs(p: Record<string, unknown>) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // localStorage may be full or blocked
  }
}
function loadTurns(): Turn[] {
  try {
    return JSON.parse(localStorage.getItem(TURN_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveTurns(t: Turn[]) {
  try {
    localStorage.setItem(TURN_KEY, JSON.stringify(t.slice(-MAX_TURNS)));
  } catch {
    // ignore
  }
}

export default function BlankDemo() {
  const isDev = import.meta.env.MODE !== "production";
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [voiceOn, setVoiceOn] = useState<boolean>(
    () => loadPrefs().voice !== false
  );
  const [speaking, setSpeaking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    savePrefs({ voice: voiceOn });
  }, [voiceOn]);

  // exit-export: ship state on tab close / hide
  useEffect(() => {
    const ex = makeExporter(() => ({
      history: turns,
      prefs: { voice: voiceOn },
      brain: { size: brain.size },
      _closedAt: new Date().toISOString(),
    }));
    return () => ex.destroy();
  }, [turns, voiceOn]);

  const last = turns[turns.length - 1];

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const r = askBrain(text);
    const next: Turn = { q: text, r, ts: Date.now() };
    const updated = [...turns, next].slice(-MAX_TURNS);
    setTurns(updated);
    saveTurns(updated);
    setQ("");
    if (voiceOn && r.verdict === "TRUTH") speak(r.answer);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(q);
    }
  };

  const stop = () => {
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
    }
    setSpeaking(false);
    utteranceRef.current = null;
  };

  const speak = (text: string) => {
    if (typeof speechSynthesis === "undefined" || !text) return;
    stop();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1.0;
    u.volume = 1.0;
    u.onstart = () => setSpeaking(true);
    u.onend = () => {
      setSpeaking(false);
      utteranceRef.current = null;
    };
    u.onerror = () => {
      setSpeaking(false);
      utteranceRef.current = null;
    };
    utteranceRef.current = u;
    speechSynthesis.speak(u);
  };

  const verdictClass = useMemo(() => {
    if (!last) return "";
    return last.r.verdict === "TRUTH"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
      : "bg-zinc-500/10 text-zinc-500 border-zinc-500/30";
  }, [last]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/30 to-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10 md:py-16">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">TRU</h1>
            <p className="text-sm text-muted-foreground">
              {isDev ? "development" : "production"} · brain: {brain.size} facts
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (voiceOn) stop();
              setVoiceOn((v) => !v);
            }}
            className={
              "rounded-md border px-3 py-1.5 text-xs font-medium transition " +
              (voiceOn
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                : "border-border bg-muted/40 text-muted-foreground")
            }
          >
            {voiceOn ? "🔊 voice" : "🔇 voice"}
          </button>
        </header>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Ask</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              rows={2}
              placeholder="ask in plain language — enter to send, shift+enter for newline"
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => submit(q)}
                disabled={!q.trim()}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </CardContent>
        </Card>

        {last && (
          <Card className={"mb-6 border " + verdictClass}>
            <CardContent className="pt-6">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider">
                <Badge variant="outline">
                  {last.r.verdict} · {last.r.score}%
                </Badge>
                {last.r.key && (
                  <span className="text-muted-foreground">
                    node: starter:{last.r.key}
                  </span>
                )}
                {speaking && (
                  <button
                    type="button"
                    onClick={stop}
                    className="ml-auto text-emerald-600 hover:underline"
                  >
                    stop
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {last.r.answer}
              </p>
            </CardContent>
          </Card>
        )}

        {turns.length > 1 && (
          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              History ({turns.length})
            </h2>
            {turns
              .slice()
              .reverse()
              .map((t, i) => (
                <div
                  key={turns.length - i}
                  className="rounded-md border border-border bg-muted/20 p-3 text-sm"
                >
                  <div className="mb-1 text-xs text-muted-foreground">{t.q}</div>
                  <div className="text-foreground/90">{t.r.answer}</div>
                </div>
              ))}
          </div>
        )}

        <footer className="mt-12 text-center text-xs text-muted-foreground">
          exit export → /api/tru/export · {isDev ? "dev" : "prod"} mode
        </footer>
      </div>
    </main>
  );
}
