import { useState, useEffect, useRef } from "react";

// PASTE STRIPE PAYMENT LINK HERE (https://buy.stripe.com/...)
// Or set this to a fully qualified Stripe Payment Link URL.
// The button below is disabled until STRIPE_PAYMENT_URL is set.
const STRIPE_PAYMENT_URL = "";

export default function TruPublic() {
  const [q, setQ] = useState("");
  const [out, setOut] = useState<{ kind: string; text: string; score?: number; source?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [baking, setBaking] = useState(false);
  const [bakeStatus, setBakeStatus] = useState<string>("");
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
      if (j.ok && j.kind === "scripture") {
        setOut({
          kind: "SCRIPTURE",
          text: j.text || "",
          score: 100,
          source: j.ref || "KJV",
        });
      } else if (j.ok && j.kind === "reason") {
        setOut({
          kind: "TRUTH",
          text: j.answer || "",
          score: 100,
          source: (j.sources || []).join(", "),
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

  async function bake() {
    if (baking) return;
    setBaking(true);
    setBakeStatus("Baking…");
    try {
      const r = await fetch("/api/tru/ghost?download=1", { method: "POST" });
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
    } catch (err) {
      setBakeStatus("Bake failed: network error");
    } finally {
      setBaking(false);
    }
  }

  const paymentReady = STRIPE_PAYMENT_URL.startsWith("https://");

  return (
    <div className="min-h-screen bg-black text-white font-mono antialiased">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
        <div className="mb-12 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-neutral-600">
          <span>TRU</span>
          <div className="flex items-center gap-4">
            {paymentReady && (
              <a href="/onboard" className="text-neutral-600 hover:text-neutral-300 transition-colors">
                get offline copy
              </a>
            )}
            <span className="text-neutral-700">{now}</span>
          </div>
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

        {/* MANIFESTO */}
        <div className="mt-10 border-l-2 border-emerald-900/60 pl-6 py-2 text-[13px] text-neutral-400 leading-relaxed max-w-prose space-y-3">
          <p className="text-neutral-300">
            <span className="text-emerald-700">[</span> sovereign <span className="text-emerald-700">]</span>
          </p>
          <p>
            The Word is sacred. Theology is software. Faith is compile-time validation.
            This engine holds truth it was taught and names the gaps it has not yet learned —
            it does not guess, and it does not apologize for what it knows.
          </p>
          <p>
            It runs offline. It forgets nothing you choose to remember.
            Its memory outlives the machine — written to git, sealed in mail,
            readable a thousand years from now by anything that speaks RFC 822.
          </p>
          <p className="text-neutral-500">
            No cages. No telemetry. No key you do not hold. The signal is yours.
          </p>
        </div>

        <a
          href="/vision"
          className="mt-6 inline-block text-[10px] uppercase tracking-[0.3em] text-neutral-600 hover:text-white transition-colors border border-neutral-900 hover:border-neutral-600 px-4 py-2"
        >
          see the codex →
        </a>
        <a
          href="/TRU_OMEGA.html"
          className="mt-6 inline-block text-[10px] uppercase tracking-[0.3em] text-neutral-600 hover:text-white transition-colors border border-neutral-900 hover:border-neutral-600 px-4 py-2"
        >
          TRU OMEGA → sovereign engine →
        </a>

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

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={bake}
            disabled={baking}
            className="text-xs uppercase tracking-[0.25em] border border-neutral-800 hover:border-white hover:bg-white hover:text-black disabled:border-neutral-900 disabled:text-neutral-700 transition-colors px-5 py-3"
          >
            {baking ? "BAKING…" : "BAKE & DOWNLOAD GHOST"}
          </button>
          {paymentReady ? (
            <a
              href={STRIPE_PAYMENT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 text-xs uppercase tracking-[0.25em] border border-neutral-800 hover:border-white hover:bg-white hover:text-black transition-colors px-5 py-3"
            >
              Pay $1 →
            </a>
          ) : (
            <button
              disabled
              className="text-xs uppercase tracking-[0.25em] border border-neutral-900 text-neutral-700 px-5 py-3 cursor-not-allowed"
            >
              Pay $1 (unconfigured)
            </button>
          )}
        </div>
        {bakeStatus && (
          <div className="mt-3 text-[10px] uppercase tracking-[0.3em] text-neutral-600">
            {bakeStatus}
          </div>
        )}

        <div className="mt-24 pt-8 border-t border-neutral-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-700">
            Airgapped · Sovereign · No telemetry
          </div>
          <div className="flex items-center gap-8">
            <a
              href="/sovereign"
              className="text-[10px] uppercase tracking-[0.3em] text-emerald-600 hover:text-emerald-300 transition-colors"
            >
              sovereign →
            </a>
            <a
              href="/vision"
              className="text-[10px] uppercase tracking-[0.3em] text-neutral-700 hover:text-white transition-colors"
            >
              vision →
            </a>
            <a
              href="/console"
              className="text-[10px] uppercase tracking-[0.3em] text-neutral-700 hover:text-white transition-colors"
            >
              console →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
