import { useCallback, useEffect, useState } from "react";
import { apiUrl, siteUrl } from "../lib/api";

type SearchResult = { title: string; url: string; snippet: string };
type MemEntry = { id: string; ts: number; updated: number; kind: string; text: string; tags: string[] };
type Status = { ok: boolean; gate?: boolean; bridge?: boolean; owner?: string };

const GATE_KEY = "tru_gate";

export default function TruSovereign() {
  const [gate, setGate] = useState<string>("");
  const [gateInput, setGateInput] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const [sq, setSq] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // sovereign metrics
  const [metrics, setMetrics] = useState<any>(null);
  const [alsoAskTru, setAlsoAskTru] = useState(false);
  const [truRead, setTruRead] = useState<{ kind?: string; v?: string; text?: string; score?: number; source?: string; ref?: string } | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const [reflectResult, setReflectResult] = useState<any>(null);
  // restore + export state
  const [versions, setVersions] = useState<any[]>([]);
  const [restoreReport, setRestoreReport] = useState<any>(null);

  const [askQ, setAskQ] = useState("");
  const [askA, setAskA] = useState<any>(null);
  const [asking, setAsking] = useState(false);

  const [entries, setEntries] = useState<MemEntry[]>([]);
  const [version, setVersion] = useState(0);
  const [memFilter, setMemFilter] = useState("");
  const [etxt, setEtxt] = useState("");
  const [ekind, setEkind] = useState("note");
  const [etags, setEtags] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [memBusy, setMemBusy] = useState(false);
  const [archiveReport, setArchiveReport] = useState<any>(null);

  const [mTo, setMTo] = useState("");
  const [mSubject, setMSubject] = useState("");
  const [mBody, setMBody] = useState("");
  const [mailResult, setMailResult] = useState<any>(null);
  const [readQ, setReadQ] = useState("subject:TRU");
  const [inbox, setInbox] = useState<any[]>([]);
  const [mailBusy, setMailBusy] = useState(false);

  const unlocked = !!gate;
  const push = useCallback((l: string) => setLog((p) => [`[${new Date().toISOString().slice(11, 19)}] ${l}`, ...p].slice(0, 40)), []);
  const authH = useCallback(() => (gate ? { Authorization: `Bearer ${gate}` } : {}) as Record<string, string>, [gate]);

  // boot gate from sessionStorage
  useEffect(() => {
    const g = sessionStorage.getItem(GATE_KEY) || "";
    if (g) setGate(g);
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/tru/metrics"));
      const j = await r.json();
      if (j.ok) setMetrics(j);
    } catch {}
  }, []);

  useEffect(() => { loadMetrics(); const t = setInterval(loadMetrics, 60000); return () => clearInterval(t); }, [loadMetrics]);

  const unlock = () => {
    const g = gateInput.trim();
    if (!g) return;
    sessionStorage.setItem(GATE_KEY, g);
    setGate(g);
    setGateInput("");
    push("GATE · unlocked");
  };
  const lock = () => {
    sessionStorage.removeItem(GATE_KEY);
    setGate("");
    setStatus(null);
    setEntries([]);
    push("GATE · locked");
  };

  const refreshStatus = useCallback(async () => {
    if (!gate) return;
    try {
      const r = await fetch(apiUrl("/api/tru/mail/status"), { headers: authH() });
      const j = await r.json();
      setStatus(j);
      push(`STATUS · gate=${j.gate} bridge=${j.bridge} owner=${j.owner}`);
    } catch {
      push("STATUS · unreachable");
    }
  }, [gate, authH, push]);

  const loadMem = useCallback(async () => {
    if (!gate) return;
    try {
      const r = await fetch(apiUrl("/api/tru/memory"), { headers: authH() });
      const j = await r.json();
      if (j.ok) {
        setEntries(j.entries || []);
        setVersion(j.version || 0);
      } else push(`MEMORY · load fail · ${j.error}`);
    } catch {
      push("MEMORY · load fail · network");
    }
  }, [gate, authH, push]);

  useEffect(() => {
    if (unlocked) {
      refreshStatus();
      loadMem();
    }
  }, [unlocked, refreshStatus, loadMem]);

  const doSearch = async () => {
    if (!sq.trim() || searching) return;
    setSearching(true);
    setResults([]);
    push(`SEARCH · ${sq}`);
    try {
      const r = await fetch(apiUrl(`/api/tru/search?q=${encodeURIComponent(sq)}`));
      const j = await r.json();
      if (j.ok) {
        setResults(j.results || []);
        push(`SEARCH · ${j.count} results`);
      } else push(`SEARCH · fail · ${j.error}`);
    } catch {
      push("SEARCH · fail · network");
    } finally {
      setSearching(false);
    }
    // Also ask TRU if toggled on
    if (alsoAskTru && sq.trim()) {
      setTruRead(null);
      try {
        const tr = await fetch(apiUrl("/api/tru/ask"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: sq.trim() }) });
        const tj = await tr.json();
        if (tj.ok) {
          setTruRead({ kind: tj.t || tj.kind, v: tj.v || tj.text, text: tj.text, score: tj.score, source: tj.source, ref: tj.ref });
          push(`TRU · read · ${tj.t || tj.kind} · ${tj.score ?? 0}%`);
        }
      } catch {
        push("TRU · read · fail");
      }
    }
  };

  const doReflect = async () => {
    if (reflecting) return;
    setReflecting(true);
    setReflectResult(null);
    push("REFLECT · distilling recent asks…");
    try {
      const r = await fetch(apiUrl("/api/tru/reflect"), { method: "POST", headers: { ...authH() } });
      const j = await r.json();
      setReflectResult(j);
      if (j.ok) {
        push(`REFLECT · ${j.written || 0} memories written · ${j.skipped || 0} skipped`);
        if (j.written > 0) loadMem();
      } else push(`REFLECT · fail · ${j.error || j.detail || "—"}`);
    } catch {
      push("REFLECT · fail · network");
    } finally {
      setReflecting(false);
    }
  };

  const doAsk = async () => {
    if (!askQ.trim() || asking || !unlocked) return;
    setAsking(true);
    setAskA(null);
    push(`TRU · ${askQ}`);
    try {
      const r = await fetch(apiUrl("/api/tru/ask/sovereign"), {
        method: "POST",
        headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({ q: askQ.trim() }),
      });
      const j = await r.json();
      setAskA(j);
      push(`TRU · ${j.ok ? j.kind : "fail"} · score=${j.score ?? "—"} mem=${j.memory?.length ?? 0}`);
    } catch {
      push("TRU · fail · network");
    } finally {
      setAsking(false);
    }
  };

  const saveEntry = async () => {
    if (!etxt.trim() || memBusy) return;
    setMemBusy(true);
    const body: any = { text: etxt.trim(), kind: ekind, tags: etags.split(",").map((t) => t.trim()).filter(Boolean) };
    if (editId) body.id = editId;
    try {
      const r = await fetch(apiUrl("/api/tru/memory"), { method: "POST", headers: { ...authH(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.ok) {
        push(`MEMORY · ${editId ? "updated" : "created"} · ${j.entry.id}`);
        setEtxt(""); setEkind("note"); setEtags(""); setEditId(null);
        await loadMem();
      } else push(`MEMORY · save fail · ${j.error}`);
    } catch {
      push("MEMORY · save fail · network");
    } finally {
      setMemBusy(false);
    }
  };

  const editEntry = (e: MemEntry) => {
    setEditId(e.id);
    setEtxt(e.text);
    setEkind(e.kind || "note");
    setEtags((e.tags || []).join(", "));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteEntry = async (id: string) => {
    if (memBusy) return;
    setMemBusy(true);
    try {
      const r = await fetch(apiUrl(`/api/tru/memory?id=${id}`), { method: "DELETE", headers: authH() });
      const j = await r.json();
      if (j.ok) {
        push(`MEMORY · deleted · ${id}`);
        if (editId === id) { setEditId(null); setEtxt(""); setEtags(""); }
        await loadMem();
      } else push(`MEMORY · delete fail · ${j.error}`);
    } catch {
      push("MEMORY · delete fail · network");
    } finally {
      setMemBusy(false);
    }
  };

  const archive = async () => {
    if (memBusy) return;
    setMemBusy(true);
    setArchiveReport(null);
    push("ARCHIVE · git + mail …");
    try {
      const r = await fetch(apiUrl("/api/tru/memory/archive"), { method: "POST", headers: authH() });
      const j = await r.json();
      setArchiveReport(j);
      push(`ARCHIVE · git=${j.git?.pushed || j.git?.error || "—"} mail=${j.mail?.ok ? "sent" : j.mail?.detail || "—"}`);
    } catch {
      push("ARCHIVE · fail · network");
    } finally {
      setMemBusy(false);
    }
  };

  const exportMem = async () => {
    try {
      const r = await fetch(apiUrl("/api/tru/memory/export"), { headers: authH() });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TRU_memory_export_v${version}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      push("EXPORT · downloaded");
    } catch {
      push("EXPORT · fail");
    }
  };

  const loadVersions = async () => {
    try {
      const r = await fetch(apiUrl("/api/tru/memory/versions"), { headers: authH() });
      const j = await r.json();
      if (j.ok) { setVersions(j.versions || []); push(`VERSIONS · ${j.count} git versions`); }
      else push(`VERSIONS · fail · ${j.error}`);
    } catch { push("VERSIONS · fail · network"); }
  };

  const restoreLatest = async () => {
    setMemBusy(true); setRestoreReport(null);
    try {
      const r = await fetch(apiUrl("/api/tru/memory/restore"), { method: "POST", headers: { ...authH(), "Content-Type": "application/json" }, body: JSON.stringify({ source: "git-latest" }) });
      const j = await r.json();
      setRestoreReport(j);
      if (j.ok) { await loadMem(); push(`RESTORE · git-latest · ${j.before}→${j.after} entries`); }
      else push(`RESTORE · fail · ${j.error}`);
    } catch { push("RESTORE · fail · network"); }
    finally { setMemBusy(false); }
  };

  const restoreFromHash = async (hash: string) => {
    setMemBusy(true); setRestoreReport(null);
    try {
      const r = await fetch(apiUrl("/api/tru/memory/restore"), { method: "POST", headers: { ...authH(), "Content-Type": "application/json" }, body: JSON.stringify({ source: "git", hash }) });
      const j = await r.json();
      setRestoreReport(j);
      if (j.ok) { await loadMem(); push(`RESTORE · ${hash.slice(0,8)} · ${j.before}→${j.after} entries`); }
      else push(`RESTORE · fail · ${j.error}`);
    } catch { push("RESTORE · fail · network"); }
    finally { setMemBusy(false); }
  };

  const sendMail = async () => {
    if (mailBusy || (!mSubject && !mBody)) return;
    setMailBusy(true);
    setMailResult(null);
    try {
      const r = await fetch(apiUrl("/api/tru/mail"), { method: "POST", headers: { ...authH(), "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", to: mTo || undefined, subject: mSubject, body: mBody }) });
      const j = await r.json();
      setMailResult(j);
      push(`MAIL · send · ${j.ok ? "ok" : j.detail || "fail"}`);
    } catch {
      push("MAIL · send · network");
    } finally {
      setMailBusy(false);
    }
  };

  const readMail = async () => {
    if (mailBusy) return;
    setMailBusy(true);
    setInbox([]);
    try {
      const r = await fetch(apiUrl("/api/tru/mail"), { method: "POST", headers: { ...authH(), "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", query: readQ, max: 8 }) });
      const j = await r.json();
      if (j.ok) {
        const list = typeof j.detail === "string" ? safeParse(j.detail) : j.detail;
        setInbox(Array.isArray(list) ? list : []);
        push(`MAIL · read · ${Array.isArray(list) ? list.length : 0} msgs`);
      } else {
        setMailResult(j);
        push(`MAIL · read fail · ${j.detail || "—"}`);
      }
    } catch {
      push("MAIL · read · network");
    } finally {
      setMailBusy(false);
    }
  };

  const safeParse = (s: string): any => { try { return JSON.parse(s); } catch { return []; } };

  const filtered = memFilter
    ? entries.filter((e) => e.text.toLowerCase().includes(memFilter.toLowerCase()) || (e.tags || []).some((t) => t.toLowerCase().includes(memFilter.toLowerCase())))
    : entries;

  return (
    <div className="min-h-screen bg-black text-emerald-400 font-mono antialiased">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-neutral-900 pb-4 mb-8">
          <div className="flex items-center gap-4">
            <span className="text-[11px] uppercase tracking-[0.4em] text-emerald-300">TRU · SOVEREIGN</span>
            <span className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 hidden sm:inline">search · memory · mail</span>
          </div>
          <div className="flex items-center gap-4">
            {unlocked ? (
              <button onClick={lock} className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 hover:text-red-400">lock</button>
            ) : (
              <span className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">locked</span>
            )}
            <a href={siteUrl("/")} className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 hover:text-emerald-400">← tru</a>
          </div>
        </div>

        {/* METRICS — sovereign, always visible */}
        {metrics && (
          <div className="border border-neutral-900 bg-neutral-950/40 p-6 mb-8">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-4">Sovereign Metrics</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-2xl text-emerald-200 tabular-nums">{metrics.daysSovereign}</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 mt-1">days sovereign</div>
              </div>
              <div>
                <div className="text-2xl text-emerald-200 tabular-nums">{metrics.commits}</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 mt-1">commits</div>
              </div>
              <div>
                <div className="text-2xl text-emerald-200 tabular-nums">{metrics.brain?.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 mt-1">brain nodes</div>
              </div>
              <div>
                <div className="text-2xl text-emerald-200 tabular-nums">{metrics.kjv?.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 mt-1">kjv verses</div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[11px]">
              <div>
                <div className="text-neutral-600 uppercase tracking-[0.2em] mb-1">uptime</div>
                <div className="text-neutral-300">{Math.floor(metrics.uptimeSec / 3600)}h {Math.floor((metrics.uptimeSec % 3600) / 60)}m</div>
              </div>
              <div>
                <div className="text-neutral-600 uppercase tracking-[0.2em] mb-1">brain store</div>
                <div className="text-neutral-300">{metrics.brainMb} MB</div>
              </div>
              <div>
                <div className="text-neutral-600 uppercase tracking-[0.2em] mb-1">epoch</div>
                <div className="text-neutral-300">{metrics.epoch}</div>
              </div>
            </div>
            {metrics.stack?.length > 0 && (
              <div className="mt-4 pt-4 border-t border-neutral-900">
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 mb-2">sovereign stack</div>
                <div className="flex flex-wrap gap-2">
                  {metrics.stack.map((s: any) => (
                    <span key={s.name} title={s.role} className="text-[10px] uppercase tracking-[0.2em] text-emerald-600 border border-neutral-800 px-2 py-1">{s.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* GATE (if locked) */}
        {!unlocked && (
          <div className="border border-neutral-900 bg-neutral-950/40 p-6 mb-8">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-3">Owner Gate</div>
            <div className="text-xs text-neutral-500 mb-4">Memory &amp; mail require the TRU_API_KEY. Search below is keyless and works now.</div>
            <div className="flex gap-3">
              <input
                type="password"
                value={gateInput}
                onChange={(e) => setGateInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && unlock()}
                placeholder="TRU_API_KEY"
                className="flex-1 bg-black border border-neutral-800 px-3 py-2 text-sm text-emerald-200 outline-none focus:border-emerald-700"
              />
              <button onClick={unlock} className="px-6 py-2 text-xs uppercase tracking-[0.3em] border-2 border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black">unlock</button>
            </div>
          </div>
        )}

        {/* STATUS (if unlocked) */}
        {unlocked && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="border border-neutral-900 bg-neutral-950/40 p-4">
              <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-1">Gate</div>
              <div className={`text-lg ${status?.gate ? "text-emerald-300" : "text-red-400"}`}>{status?.gate ? "ARMED" : "—"}</div>
            </div>
            <div className="border border-neutral-900 bg-neutral-950/40 p-4">
              <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-1">Mail Bridge</div>
              <div className={`text-lg ${status?.bridge ? "text-emerald-300" : "text-amber-400"}`}>{status?.bridge ? "LIVE" : "NO KEY"}</div>
            </div>
            <div className="border border-neutral-900 bg-neutral-950/40 p-4">
              <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-1">Archive To</div>
              <div className="text-[11px] text-neutral-300 truncate" title={status?.owner}>{status?.owner || "—"}</div>
            </div>
          </div>
        )}

        {/* SOVEREIGN ASK — gated, memory-augmented retrieval */}
        {unlocked && (
          <div className="border border-neutral-900 bg-neutral-950/40 p-6 mb-8">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-3">Sovereign Ask · brain + scripture + memory</div>
            <div className="flex gap-3 mb-4">
              <input
                value={askQ}
                onChange={(e) => setAskQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doAsk()}
                placeholder="ask TRU — it consults its own memory…"
                className="flex-1 bg-black border border-neutral-800 px-3 py-2 text-sm text-emerald-200 outline-none focus:border-emerald-700"
              />
              <button onClick={doAsk} disabled={asking || !askQ.trim()} className="px-6 py-2 text-xs uppercase tracking-[0.3em] border-2 border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black disabled:border-neutral-800 disabled:text-neutral-600">
                {asking ? "…" : "ask"}
              </button>
            </div>
            {askA && (
              <div className="border border-neutral-800 bg-black/50 p-4">
                <div className="flex items-center gap-3 mb-2 text-[10px] uppercase tracking-[0.2em] text-neutral-600">
                  <span className="text-emerald-400">{askA.kind || "—"}</span>
                  {askA.ref && <span className="text-emerald-300">{askA.ref}</span>}
                  <span>score {askA.score ?? 0}</span>
                  {askA.memory?.length > 0 && <span className="text-amber-400">memory · {askA.memory.length}</span>}
                  {askA.learned?.length > 0 && <span className="text-cyan-400">auto-learned · {askA.learned.length}</span>}
                </div>
                <div className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">{askA.v || askA.text || ""}</div>
                {askA.learned?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-neutral-900">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-500 mb-1">self-written</div>
                    {askA.learned.map((l: any) => (
                      <div key={l.id} className="text-[11px] text-neutral-400 mb-1">
                        <span className="text-cyan-600">[{l.kind}]</span> {l.text}
                      </div>
                    ))}
                  </div>
                )}
                {askA.memory?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-neutral-900">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-amber-500 mb-1">remembered</div>
                    {askA.memory.map((m: any) => (
                      <div key={m.id} className="text-[11px] text-neutral-400 mb-1">
                        <span className="text-amber-600">[{m.kind}]</span> {m.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SEARCH — always available, keyless */}
        <div className="border border-neutral-900 bg-neutral-950/40 p-6 mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">Search · keyless · DuckDuckGo</div>
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-neutral-600 cursor-pointer">
              <input type="checkbox" checked={alsoAskTru} onChange={(e) => setAlsoAskTru(e.target.checked)} className="accent-emerald-500" />
              ∑ also ask TRU
            </label>
          </div>
          <div className="flex gap-3 mb-4">
            <input
              value={sq}
              onChange={(e) => setSq(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="ask the open web…"
              className="flex-1 bg-black border border-neutral-800 px-3 py-2 text-sm text-emerald-200 outline-none focus:border-emerald-700"
            />
            <button onClick={doSearch} disabled={searching} className="px-6 py-2 text-xs uppercase tracking-[0.3em] border-2 border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black disabled:border-neutral-800 disabled:text-neutral-600">
              {searching ? "…" : "search"}
            </button>
          </div>
          <div className="space-y-3">
            {results.map((r, i) => (
              <a key={i} href={r.url} target="_blank" rel="noreferrer" className="block group">
                <div className="text-sm text-emerald-300 group-hover:underline">{r.title}</div>
                <div className="text-[10px] text-neutral-600 truncate">{r.url}</div>
                <div className="text-[11px] text-neutral-400 mt-1">{r.snippet}</div>
              </a>
            ))}
            {results.length === 0 && sq && !searching && <div className="text-[11px] text-neutral-700">no results</div>}
          </div>

          {truRead && (
            <div className="mt-4 pt-4 border-t border-neutral-900">
              <div className="flex items-center gap-3 mb-2 text-[10px] uppercase tracking-[0.2em] text-neutral-600">
                <span className="text-emerald-400">{truRead.kind || "TRU"}</span>
                <span>score {truRead.score ?? 0}</span>
                {truRead.source && <span>· {truRead.source}</span>}
              </div>
              <div className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">{truRead.v || truRead.text || ""}</div>
            </div>
          )}
        </div>

        {/* MEMORY — gated */}
        {unlocked && (
          <div className="border border-neutral-900 bg-neutral-950/40 p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-1">Memory · v{version} · {entries.length} entries</div>
                <div className="text-xs text-neutral-500">load · write · delete · archive (git + mail)</div>
              </div>
              <div className="flex gap-3">
                <button onClick={archive} disabled={memBusy || entries.length === 0} className="px-4 py-2 text-[10px] uppercase tracking-[0.3em] border border-emerald-700 text-emerald-300 hover:bg-emerald-700/30 disabled:border-neutral-800 disabled:text-neutral-600">
                  {memBusy ? "…" : "archive"}
                </button>
                <button onClick={exportMem} disabled={entries.length === 0} className="px-4 py-2 text-[10px] uppercase tracking-[0.3em] border border-neutral-700 text-neutral-300 hover:text-emerald-300 disabled:border-neutral-800 disabled:text-neutral-600">
                  export
                </button>
                <button onClick={loadVersions} className="px-4 py-2 text-[10px] uppercase tracking-[0.3em] border border-neutral-700 text-neutral-300 hover:text-emerald-300">
                  versions
                </button>
                <button onClick={doReflect} disabled={reflecting} className="px-4 py-2 text-[10px] uppercase tracking-[0.3em] border border-amber-700 text-amber-300 hover:bg-amber-700/30 disabled:border-neutral-800 disabled:text-neutral-600">
                  {reflecting ? "…" : "reflect"}
                </button>
                <button onClick={loadMem} className="px-4 py-2 text-[10px] uppercase tracking-[0.3em] border border-neutral-800 text-neutral-400 hover:text-emerald-300">reload</button>
              </div>
            </div>

            {archiveReport && (
              <div className="border border-neutral-800 bg-black/50 p-3 mb-4 text-[11px]">
                <span className="text-neutral-500">archive: </span>
                <span className="text-emerald-300">git={archiveReport.git?.pushed || archiveReport.git?.error || "—"}</span>
                <span className="text-neutral-600"> · </span>
                <span className={archiveReport.mail?.ok ? "text-emerald-300" : "text-amber-400"}>mail={archiveReport.mail?.ok ? "sent" : archiveReport.mail?.detail || "—"}</span>
              </div>
            )}

            {reflectResult && (
              <div className="border border-amber-900/50 bg-black/50 p-3 mb-4 text-[11px]">
                <span className="text-amber-500">reflect: </span>
                <span className="text-amber-300">{reflectResult.ok ? `${reflectResult.written || 0} written · ${reflectResult.skipped || 0} skipped · ${reflectResult.distilled || "—"} distilled` : reflectResult.error || reflectResult.detail || "fail"}</span>
              </div>
            )}

            {restoreReport && (
              <div className="border border-cyan-900/50 bg-black/50 p-3 mb-4 text-[11px]">
                <span className="text-cyan-500">restore: </span>
                <span className={restoreReport.ok ? "text-emerald-300" : "text-red-400"}>{restoreReport.ok ? `${restoreReport.source} · ${restoreReport.before}→${restoreReport.after} entries · v${restoreReport.version}` : restoreReport.error || "fail"}</span>
              </div>
            )}

            {versions.length > 0 && (
              <div className="border border-neutral-900 bg-black/50 p-3 mb-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 mb-2">git history · click to restore</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {versions.map((v, i) => (
                    <div key={i} className="flex items-center gap-3 text-[11px]">
                      <button onClick={() => restoreFromHash(v.hash)} disabled={memBusy} className="text-cyan-400 hover:text-cyan-200 disabled:text-neutral-700 tabular-nums">{v.hash.slice(0, 8)}</button>
                      <span className="text-neutral-500">{new Date(v.ts).toISOString().slice(0, 16).replace("T", " ")}</span>
                      <span className="text-neutral-600 truncate">{v.subject}</span>
                    </div>
                  ))}
                </div>
                <button onClick={restoreLatest} disabled={memBusy} className="mt-2 px-3 py-1 text-[10px] uppercase tracking-[0.2em] border border-cyan-700 text-cyan-300 hover:bg-cyan-700/30 disabled:border-neutral-800 disabled:text-neutral-600">restore latest</button>
              </div>
            )}

            {/* editor */}
            <div className="border border-neutral-900 bg-black/40 p-4 mb-4">
              <div className="flex gap-2 mb-2">
                <input value={ekind} onChange={(e) => setEkind(e.target.value)} placeholder="kind" className="w-24 bg-black border border-neutral-800 px-2 py-1 text-[11px] text-emerald-200 outline-none focus:border-emerald-700" />
                <input value={etags} onChange={(e) => setEtags(e.target.value)} placeholder="tags (comma)" className="flex-1 bg-black border border-neutral-800 px-2 py-1 text-[11px] text-emerald-200 outline-none focus:border-emerald-700" />
              </div>
              <textarea value={etxt} onChange={(e) => setEtxt(e.target.value)} placeholder="memory text…" rows={3} className="w-full bg-black border border-neutral-800 px-3 py-2 text-sm text-emerald-200 outline-none focus:border-emerald-700 resize-y" />
              <div className="flex gap-3 mt-2">
                <button onClick={saveEntry} disabled={memBusy || !etxt.trim()} className="px-4 py-1.5 text-[10px] uppercase tracking-[0.3em] border border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black disabled:border-neutral-800 disabled:text-neutral-600">
                  {memBusy ? "…" : editId ? "update" : "save"}
                </button>
                {editId && (
                  <button onClick={() => { setEditId(null); setEtxt(""); setEtags(""); setEkind("note"); }} className="px-4 py-1.5 text-[10px] uppercase tracking-[0.3em] text-neutral-500 hover:text-neutral-300">cancel</button>
                )}
              </div>
            </div>

            <input value={memFilter} onChange={(e) => setMemFilter(e.target.value)} placeholder="filter memory…" className="w-full bg-black border border-neutral-800 px-3 py-2 text-xs text-emerald-200 outline-none focus:border-emerald-700 mb-3" />

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filtered.length === 0 && <div className="text-[11px] text-neutral-700">no entries</div>}
              {filtered.map((e) => (
                <div key={e.id} className="border border-neutral-900 bg-black/40 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 text-[10px] text-neutral-600">
                      <span className="text-emerald-600">{e.kind}</span>
                      <span>{new Date(e.updated || e.ts).toISOString().slice(0, 16).replace("T", " ")}</span>
                      {e.tags?.map((t) => <span key={t} className="text-neutral-500">#{t}</span>)}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => editEntry(e)} className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 hover:text-emerald-300">edit</button>
                      <button onClick={() => deleteEntry(e.id)} className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 hover:text-red-400">del</button>
                    </div>
                  </div>
                  <div className="text-xs text-neutral-300 whitespace-pre-wrap">{e.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MAIL — gated */}
        {unlocked && (
          <div className="border border-neutral-900 bg-neutral-950/40 p-6 mb-8">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-3">Mail · via connected Gmail bridge</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-neutral-900 bg-black/40 p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 mb-2">Send</div>
                <input value={mTo} onChange={(e) => setMTo(e.target.value)} placeholder="to (blank = self)" className="w-full bg-black border border-neutral-800 px-2 py-1.5 text-[11px] text-emerald-200 mb-2 outline-none focus:border-emerald-700" />
                <input value={mSubject} onChange={(e) => setMSubject(e.target.value)} placeholder="subject" className="w-full bg-black border border-neutral-800 px-2 py-1.5 text-[11px] text-emerald-200 mb-2 outline-none focus:border-emerald-700" />
                <textarea value={mBody} onChange={(e) => setMBody(e.target.value)} placeholder="body…" rows={4} className="w-full bg-black border border-neutral-800 px-2 py-1.5 text-[11px] text-emerald-200 mb-2 outline-none focus:border-emerald-700 resize-y" />
                <button onClick={sendMail} disabled={mailBusy || (!mSubject && !mBody)} className="px-4 py-1.5 text-[10px] uppercase tracking-[0.3em] border border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black disabled:border-neutral-800 disabled:text-neutral-600">{mailBusy ? "…" : "send"}</button>
                {mailResult && <div className={`mt-2 text-[11px] ${mailResult.ok ? "text-emerald-300" : "text-amber-400"}`}>{typeof mailResult.detail === "string" ? mailResult.detail : JSON.stringify(mailResult.detail)}</div>}
              </div>
              <div className="border border-neutral-900 bg-black/40 p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 mb-2">Read inbox</div>
                <input value={readQ} onChange={(e) => setReadQ(e.target.value)} placeholder="gmail query" className="w-full bg-black border border-neutral-800 px-2 py-1.5 text-[11px] text-emerald-200 mb-2 outline-none focus:border-emerald-700" />
                <button onClick={readMail} disabled={mailBusy} className="px-4 py-1.5 text-[10px] uppercase tracking-[0.3em] border border-emerald-700 text-emerald-300 hover:bg-emerald-700/30 disabled:border-neutral-800 disabled:text-neutral-600">{mailBusy ? "…" : "fetch"}</button>
                <div className="mt-2 space-y-2 max-h-56 overflow-y-auto">
                  {inbox.map((m, i) => (
                    <div key={i} className="border border-neutral-900 p-2">
                      <div className="text-[11px] text-emerald-300">{m.subject}</div>
                      <div className="text-[10px] text-neutral-600">{m.from} · {m.date}</div>
                      <div className="text-[10px] text-neutral-400 mt-1">{m.snippet}</div>
                    </div>
                  ))}
                  {inbox.length === 0 && <div className="text-[10px] text-neutral-700">no messages</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LOG */}
        <div className="border border-neutral-900 bg-neutral-950/40 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">Activity</div>
            <button onClick={() => setLog([])} className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 hover:text-neutral-300">clear</button>
          </div>
          <div className="text-[11px] space-y-1 max-h-48 overflow-y-auto">
            {log.length === 0 ? <div className="text-neutral-700">no activity</div> : log.map((l, i) => <div key={i} className="text-neutral-400 tabular-nums">{l}</div>)}
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-neutral-900 text-[10px] uppercase tracking-[0.3em] text-neutral-700">
          TRU · sovereign services · search keyless · memory+mail gated · offline ghost untouched
        </div>
      </div>
    </div>
  );
}
