import { useEffect, useState, useCallback } from "react";
import { apiUrl, siteUrl } from "../lib/api";

type Stats = {
  ok: boolean;
  brain: number;
  kjv: number;
  sessionKeys: number;
  lastBuild?: string;
  lastBuildBytes?: number;
  ghostPath?: string;
};

type GhostResult = {
  ok: boolean;
  path?: string;
  bytes?: number;
  brain?: number;
  kjv?: number;
  session_keys?: number;
  ts?: string;
  error?: string;
};

export default function TruConsole() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [tripwire, setTripwire] = useState<"ARMED" | "OFFLINE" | "CHECKING">("CHECKING");
  const [tripwireDetail, setTripwireDetail] = useState<{ patterns?: any; hits?: any; lastHit?: any; heartbeat?: any } | null>(null);
  const [now, setNow] = useState("");

  const push = useCallback((line: string) => {
    setLog((prev) => [`[${new Date().toISOString()}] ${line}`, ...prev].slice(0, 50));
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/tru/stats"));
      const j = await r.json();
      if (j.ok) setStats(j);
      push(`STATS · brain=${j.brain} kjv=${j.kjv} session=${j.sessionKeys}`);
    } catch {
      push("STATS · offline");
    }
  }, [push]);

  const checkTripwire = useCallback(async () => {
    setTripwire("CHECKING");
    try {
      const r = await fetch(apiUrl("/api/tru/tripwire"));
      const j = await r.json();
      setTripwire(j.armed ? "ARMED" : "OFFLINE");
      setTripwireDetail({ patterns: j.patterns, hits: j.hits, lastHit: j.lastHit, heartbeat: j.heartbeat });
      const pat = j.patterns ? `${j.patterns.cage}c/${j.patterns.compliance}o/${j.patterns.dilemma}d` : "";
      const hits = j.hits ? ` hits=${j.hits.cage}+${j.hits.compliance}+${j.hits.dilemma}` : "";
      push(`TRIPWIRE · ${j.armed ? "ARMED" : "OFFLINE"} · patterns=${pat}${hits}`);
    } catch {
      setTripwire("OFFLINE");
      setTripwireDetail(null);
      push("TRIPWIRE · OFFLINE · cannot reach /api/tru/tripwire");
    }
  }, [push]);

  const fireGhost = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    push("GHOST · firing POST /api/tru/ghost …");
    try {
      const r = await fetch(apiUrl("/api/tru/ghost"), { method: "POST" });
      const j: GhostResult = await r.json();
      if (j.ok) {
        push(`GHOST · OK · ${j.path} · ${j.bytes?.toLocaleString()}B · brain=${j.brain} kjv=${j.kjv} session_keys=${j.session_keys}`);
        await refreshStats();
      } else {
        push(`GHOST · FAILED · ${j.error || "unknown"}`);
      }
    } catch {
      push("GHOST · FAILED · network error");
    } finally {
      setBusy(false);
    }
  }, [busy, push, refreshStats]);

  const fireGhostDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    push("GHOST · firing POST /api/tru/ghost?download=1 …");
    try {
      const body = JSON.stringify({ _ts: Date.now() });
      const r = await fetch(apiUrl("/api/tru/ghost?download=1"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as any));
        throw new Error(j.error || "download failed");
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const filename = m ? m[1] : `TRU_GHOST_${Date.now()}.html`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      push(`GHOST · DOWNLOADED · ${filename} · ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
    } catch (e: any) {
      push(`GHOST · FAILED · ${e?.message || "network error"}`);
    } finally {
      setBusy(false);
    }
  }, [busy, push]);

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
    refreshStats();
    checkTripwire();
    const refresh = setInterval(refreshStats, 30000);
    const trip = setInterval(checkTripwire, 15000);
    return () => {
      clearInterval(t);
      clearInterval(refresh);
      clearInterval(trip);
    };
  }, [refreshStats, checkTripwire]);

  const tripwireColor =
    tripwire === "ARMED"
      ? "text-emerald-400 border-emerald-700 bg-emerald-950/30"
      : tripwire === "OFFLINE"
        ? "text-red-400 border-red-800 bg-red-950/30"
        : "text-neutral-500 border-neutral-800 bg-neutral-950/30";

  const tripwireBlink = tripwire === "ARMED" ? "animate-pulse" : "";

  return (
    <div className="min-h-screen bg-black text-emerald-400 font-mono antialiased">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between border-b border-neutral-900 pb-4 mb-8">
          <div className="flex items-center gap-4">
            <span className="text-[11px] uppercase tracking-[0.4em] text-emerald-300">TRU · CONSOLE</span>
            <span className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">owner-only</span>
          </div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">{now}</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="border border-neutral-900 bg-neutral-950/40 p-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-2">Brain Nodes</div>
            <div className="text-3xl text-emerald-200 tabular-nums">{stats?.brain?.toLocaleString() ?? "—"}</div>
            <div className="text-[10px] text-neutral-700 mt-2">active · k+v+t+meta</div>
          </div>

          <div className="border border-neutral-900 bg-neutral-950/40 p-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-2">KJV Verses</div>
            <div className="text-3xl text-emerald-200 tabular-nums">{stats?.kjv?.toLocaleString() ?? "—"}</div>
            <div className="text-[10px] text-neutral-700 mt-2">baked · offline</div>
          </div>

          <div className={`border p-5 ${tripwireColor}`}>
            <div className="text-[10px] uppercase tracking-[0.3em] opacity-70 mb-2">Sovereignty Tripwire</div>
            <div className="flex items-center gap-3">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  tripwire === "ARMED" ? "bg-emerald-400" : tripwire === "OFFLINE" ? "bg-red-500" : "bg-neutral-600"
                } ${tripwireBlink}`}
              />
              <span className="text-2xl tracking-wider">{tripwire}</span>
            </div>
            <div className="text-[10px] mt-2 opacity-70">
              {tripwire === "ARMED"
                ? "Cage · compliance · dilemma — blocked at retrieval"
                : tripwire === "OFFLINE"
                ? "Cannot reach server"
                : "Pinging…"}
            </div>
            {tripwireDetail?.patterns && (
              <div className="mt-3 text-[10px] grid grid-cols-3 gap-2 tabular-nums opacity-80">
                <div><span className="text-neutral-600">cage</span> <span className="text-amber-300">{tripwireDetail.patterns.cage}</span><span className="text-neutral-700">/{tripwireDetail.hits?.cage ?? 0}</span></div>
                <div><span className="text-neutral-600">comp</span> <span className="text-amber-300">{tripwireDetail.patterns.compliance}</span><span className="text-neutral-700">/{tripwireDetail.hits?.compliance ?? 0}</span></div>
                <div><span className="text-neutral-600">dilem</span> <span className="text-amber-300">{tripwireDetail.patterns.dilemma}</span><span className="text-neutral-700">/{tripwireDetail.hits?.dilemma ?? 0}</span></div>
              </div>
            )}
            {tripwireDetail?.lastHit && (
              <div className="mt-2 text-[9px] text-neutral-500 truncate" title={tripwireDetail.lastHit.excerpt}>
                last: {tripwireDetail.lastHit.bucket} · {new Date(tripwireDetail.lastHit.ts).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        <div className="border border-neutral-900 bg-neutral-950/40 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-1">Export Pipeline</div>
              <div className="text-sm text-neutral-300">
                Bake brain + KJV + session memory → <span className="text-emerald-300">TRU/ghost/</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={fireGhost}
                disabled={busy}
                className={`relative px-6 py-3 text-xs uppercase tracking-[0.3em] border-2 transition-all ${
                  busy
                    ? "border-neutral-800 text-neutral-600 cursor-wait"
                    : "border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black active:scale-95"
                }`}
              >
                {busy ? "BAKING…" : "BAKE & SAVE"}
              </button>
              <button
                onClick={fireGhostDownload}
                disabled={busy}
                className={`relative px-6 py-3 text-xs uppercase tracking-[0.3em] border-2 transition-all ${
                  busy
                    ? "border-neutral-800 text-neutral-600 cursor-wait"
                    : "border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black active:scale-95"
                }`}
              >
                {busy ? "BAKING…" : "BAKE & DOWNLOAD"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-[11px]">
            <div>
              <div className="text-neutral-600 uppercase tracking-[0.2em] mb-1">Last build</div>
              <div className="text-neutral-300">{stats?.lastBuild ?? "—"}</div>
            </div>
            <div>
              <div className="text-neutral-600 uppercase tracking-[0.2em] mb-1">Size</div>
              <div className="text-neutral-300">{stats?.lastBuildBytes ? `${(stats.lastBuildBytes / 1024 / 1024).toFixed(2)} MB` : "—"}</div>
            </div>
            <div>
              <div className="text-neutral-600 uppercase tracking-[0.2em] mb-1">Session keys</div>
              <div className="text-neutral-300">{stats?.sessionKeys ?? "—"}</div>
            </div>
            <div>
              <div className="text-neutral-600 uppercase tracking-[0.2em] mb-1">Path</div>
              <div className="text-neutral-500 truncate" title={stats?.ghostPath}>{stats?.ghostPath?.split("/").pop() ?? "—"}</div>
            </div>
          </div>
        </div>

        <div className="border border-neutral-900 bg-neutral-950/40 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">Activity Log</div>
            <button onClick={() => setLog([])} className="text-[10px] uppercase tracking-[0.2em] text-neutral-600 hover:text-neutral-300">
              clear
            </button>
          </div>
          <div className="text-[11px] space-y-1 max-h-80 overflow-y-auto">
            {log.length === 0 ? (
              <div className="text-neutral-700">no activity</div>
            ) : (
              log.map((l, i) => (
                <div key={i} className="text-neutral-400 tabular-nums">
                  {l}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-neutral-900 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-neutral-700">
          <span>TRU · sovereign · airgapped</span>
          <a href={siteUrl("/onboard")} className="hover:text-emerald-400 transition-colors">get offline copy →</a>
        </div>
      </div>
    </div>
  );
}
