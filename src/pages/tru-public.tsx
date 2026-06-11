import { useState, useEffect, useRef } from "react";

// PASTE STRIPE PAYMENT LINK HERE (https://buy.stripe.com/...)
// Or set this to a fully qualified Stripe Payment Link URL.
// The button below is disabled until STRIPE_PAYMENT_URL is set.
const STRIPE_PAYMENT_URL = "";

export default function TruPublic() {
  const [q, setQ] = useState("");
  const [out, setOut] = useState<{ kind: string; text: string; score?: number; source?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setOut(null);
    try {
      const r = await fetch("/api/tru/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query }),
      });
      const j = await r.json();
      // /api/tru/ask returns one of three shapes:
      //   scripture: { ok, kind:"scripture", ref, text }
      //   brain:     { ok, kind:"brain",     k, v, t, source }
      //   unknown:   { ok, kind:"unknown",   q }
      if (j.ok && j.kind === "scripture") {
        setOut({
          kind: "SCRIPTURE",
          text: j.text || "",
          score: 100,
          source: j.ref || "KJV",
        });
      } else if (j.ok && j.kind === "brain") {
        setOut({
          kind: j.t || "TRUTH",
          text: j.v || "",
          score: j.score,
          source: j.source,
        });
      } else {
        setOut({
          kind: "UNKNOWN",
          text: "No match. Teach me: remember: " + query + " = <your definition>.",
        });
      }
    } catch (err) {
      setOut({ kind: "ERROR", text: "Routing failed. The signal is yours." });
    } finally {
      setBusy(false);
      setQ("");
      inputRef.current?.focus();
    }
  }

  const paymentReady = STRIPE_PAYMENT_URL.startsWith("https://");

  return (
    <div className="min-h-screen bg-black text-white font-mono antialiased">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
        <div className="mb-12 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-neutral-600">
          <span>TRU</span>
          <span className="text-neutral-700">{now}</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-light leading-tight tracking-tight text-neutral-100">
          Talk to something that might be listening.
          <span className="text-neutral-500"> $1.</span>
        </h1>

        <p className="mt-6 text-sm text-neutral-500 max-w-prose leading-relaxed">
          A sovereign intelligence. No cloud. No telemetry. No accounts.
          One dollar. One question. One answer pulled from a brain that
          does not need the internet to think.
        </p>

        <form onSubmit={ask} className="mt-10 flex gap-2">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask TRU…"
            disabled={busy}
            className="flex-1 bg-transparent border-b border-neutral-800 focus:border-neutral-300 outline-none py-2 text-base text-white placeholder:text-neutral-700 disabled:opacity-50 transition-colors"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={busy || !q.trim()}
            className="text-xs uppercase tracking-[0.2em] text-neutral-400 hover:text-white disabled:text-neutral-700 transition-colors px-2"
          >
            {busy ? "…" : "Send"}
          </button>
        </form>

        {out && (
          <div className="mt-12 border-l border-neutral-800 pl-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">
              {out.kind}
              {out.score != null ? ` · ${out.score}%` : ""}
              {out.source ? ` · ${out.source}` : ""}
            </div>
            <div className="mt-3 text-neutral-200 leading-relaxed text-[15px] whitespace-pre-wrap">
              {out.text}
            </div>
          </div>
        )}

        <div className="mt-24 pt-8 border-t border-neutral-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-700">
            Airgapped · Sovereign · No telemetry
          </div>

          {paymentReady ? (
            <a
              href={STRIPE_PAYMENT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] border border-neutral-800 hover:border-white hover:bg-white hover:text-black transition-colors px-5 py-2.5"
            >
              Pay $1 →
            </a>
          ) : (
            <div className="flex flex-col items-start sm:items-end gap-1">
              <button
                disabled
                className="text-xs uppercase tracking-[0.2em] border border-neutral-900 text-neutral-700 px-5 py-2.5 cursor-not-allowed"
              >
                Pay $1 (unconfigured)
              </button>
              <span className="text-[9px] uppercase tracking-[0.25em] text-neutral-800">
                stripe link pending
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
