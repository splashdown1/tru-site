import { serveStatic } from "hono/bun";
import type { ViteDevServer } from "vite";
import { createServer as createViteServer } from "vite";
import config from "./zosite.json";
import { Hono } from "hono";
import { writeFileSync, existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import Database from "bun:sqlite";

// AI agents: read README.md for navigation and contribution guidance.
type Mode = "development" | "production";
const app = new Hono();

const mode: Mode =
  process.env.NODE_ENV === "production" ? "production" : "development";

// ═══════════════════════════════════════════════════════════════
// SESSION EXPORT — server-side state sink for TRU
// Browser posts state on unload; server appends to NDJSON log.
// ═══════════════════════════════════════════════════════════════
const STATE_DIR = join(process.cwd(), "state");
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const STATE_LOG = join(STATE_DIR, "TRU_state.log.ndjson");
const STATE_SNAPSHOT = join(STATE_DIR, "TRU_latest.json");
const BRAIN_DB = join(STATE_DIR, "tru_brain.db");

// Brain DB self-bootstrap: if the SQLite file is missing but the
// JSON source is available, build the DB once on first request.
// This keeps the repo free of binary blobs and lets the brain
// evolve from the JSON without a separate ETL step.
function ensureBrainDb(): void {
  if (existsSync(BRAIN_DB)) return;
  if (!existsSync(GHOST_BRAIN)) return;
  try {
    const raw = JSON.parse(readFileSync(GHOST_BRAIN, "utf-8")) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw) || raw.length === 0) return;
    const db = new Database(BRAIN_DB);
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL,
        w REAL DEFAULT 0.5,
        t TEXT,
        source TEXT,
        ref TEXT,
        greek_tr TEXT,
        greek_note TEXT,
        meta_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_w ON nodes(w DESC);
      CREATE INDEX IF NOT EXISTS idx_nodes_v ON nodes(v);
    `);
    const ins = db.prepare(
      "INSERT OR REPLACE INTO nodes (k, v, w, t, source, ref, greek_tr, greek_note, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const tx = db.transaction((rows: Array<Record<string, unknown>>) => {
      for (const n of rows) {
        ins.run(
          String(n.k ?? ""),
          String(n.v ?? ""),
          Number(n.w ?? 0.5),
          n.t ? String(n.t) : null,
          n.source ? String(n.source) : null,
          n.ref ? String(n.ref) : null,
          n.greek_tr ? String(n.greek_tr) : null,
          n.greek_note ? String(n.greek_note) : null,
          n.meta_json ? String(n.meta_json) : null,
        );
      }
    });
    tx(raw);
    db.close();
  } catch (e) {
    console.error("[brain] bootstrap failed:", e);
  }
}

// ═══════════════════════════════════════════════════════════════
// GHOST EXPORT — bake brain + active session memory into a
// self-contained HTML written to TRU/ghost/. The resulting file
// is fully airgapped: no network calls, no telemetry.
// ═══════════════════════════════════════════════════════════════
const GHOST_DIR = join(process.cwd(), "..", "TRU", "ghost");
const GHOST_BRAIN = join(process.cwd(), "..", "TRU", "TRU_BRAIN_41.json");
const GHOST_KJV = join(process.cwd(), "..", "TRU", "kjv_lookup.json");

const MAX_EXPORT_BYTES = 256 * 1024; // 256 KB cap on session payload

// Map common book spellings/abbreviations to the lowercase codes used in
// kjv_lookup.json (e.g. "mt 1:1", "jn 3:16", "1jn 1:1", "1co 13:4").
const BOOK_ALIAS: Record<string, string> = {
  // OT
  gen: "gen", genesis: "gen", gn: "gen",
  ex: "exo", exo: "exo", exodus: "exo",
  lev: "lev", le: "lev", lv: "lev",
  num: "num", nu: "num", nb: "num",
  deut: "deu", deu: "deu", dt: "deu",
  josh: "jos", jos: "jos", jsh: "jos",
  jdg: "jdg", judg: "jdg", jdgs: "jdg",
  rut: "rut", ruth: "rut", rth: "rut",
  "1sa": "1sa", "1sam": "1sa", "1samuel": "1sa",
  "2sa": "2sa", "2sam": "2sa", "2samuel": "2sa",
  "1ki": "1ki", "1kings": "1ki",
  "2ki": "2ki", "2kings": "2ki",
  "1ch": "1ch", "1chr": "1ch", "1chronicles": "1ch",
  "2ch": "2ch", "2chr": "2ch", "2chronicles": "2ch",
  ezr: "ezr", ezra: "ezr",
  neh: "neh", nehemiah: "neh",
  est: "est", esth: "est", ester: "est",
  job: "job", jb: "job",
  ps: "ps", psa: "ps", psalm: "ps", psalms: "ps",
  prov: "pro", pro: "pro", pr: "pro",
  ecc: "ecc", eccl: "ecc", ec: "ecc", qoh: "ecc",
  sng: "sng", song: "sng", songs: "sng", sos: "sng",
  isa: "isa", isaiah: "isa", is: "isa",
  jer: "jer", jr: "jer",
  lam: "lam", lamentations: "lam",
  ezk: "ezk", ezek: "ezk", eze: "ezk",
  dan: "dan", dn: "dan",
  hos: "hos", hosea: "hos",
  jol: "jol", joel: "jol",
  amo: "amo", amos: "amo",
  oba: "oba", obad: "oba", obadiah: "oba",
  jon: "jon", jonah: "jon",
  mic: "mic", micah: "mic",
  nam: "nam", nah: "nam",
  hab: "hab", habakkuk: "hab",
  zep: "zep", zeph: "zep",
  hag: "hag", haggai: "hag",
  zec: "zec", zech: "zec",
  mal: "mal", malachi: "mal",
  // NT
  mt: "mt", matt: "mt", matthew: "mt",
  mk: "mk", mark: "mk", mar: "mk", mr: "mk",
  lk: "lk", luke: "lk", lu: "lk",
  jn: "jn", john: "jn", jhn: "jn",
  ac: "ac", acts: "ac", act: "ac",
  rom: "rom", romans: "rom", rm: "rom",
  "1co": "1co", "1cor": "1co", "1corinthians": "1co",
  "2co": "2co", "2cor": "2co", "2corinthians": "2co",
  gal: "gal", galatians: "gal", ga: "gal",
  eph: "eph", ephesians: "eph",
  phil: "phil", philippians: "phil", php: "phil",
  col: "col", colossians: "col",
  "1th": "1th", "1thes": "1th", "1thess": "1th", "1thessalonians": "1th",
  "2th": "2th", "2thes": "2th", "2thess": "2th", "2thessalonians": "2th",
  "1ti": "1ti", "1tim": "1ti", "1timothy": "1ti",
  "2ti": "2ti", "2tim": "2ti", "2timothy": "2ti",
  tit: "tit", titus: "tit",
  phm: "phm", philemon: "phm",
  heb: "heb", hebrews: "heb",
  jas: "jas", james: "jas", jam: "jas",
  "1pe": "1pe", "1pet": "1pe", "1peter": "1pe",
  "2pe": "2pe", "2pet": "2pe", "2peter": "2pe",
  "1jn": "1jn", "1john": "1jn", "1jhn": "1jn",
  "2jn": "2jn", "2john": "2jn", "2jhn": "2jn",
  "3jn": "3jn", "3john": "3jn", "3jhn": "3jn",
  jud: "jud", jude: "jud",
  rev: "rev", revelation: "rev", ap: "rev",
};

function parseVerse(q: string): { key: string; book: string; chapter: number; verse: number } | null {
  const m = q.toLowerCase().trim().match(/^([1-3]?\s?[a-z]+)\s+(\d+):(\d+)$/);
  if (!m) return null;
  const book = BOOK_ALIAS[m[1].replace(/\s+/g, "")];
  if (!book) return null;
  const chapter = parseInt(m[2], 10);
  const verse = parseInt(m[3], 10);
  return { key: `${book} ${chapter}:${verse}`, book, chapter, verse };
}

function mergeSnapshot(payload: Record<string, unknown>) {
  let current: Record<string, unknown> = {};
  if (existsSync(STATE_SNAPSHOT)) {
    try {
      current = JSON.parse(readFileSync(STATE_SNAPSHOT, "utf8"));
    } catch {
      current = {};
    }
  }
  // Append to history[] (capped at 200) instead of replacing
  if (Array.isArray(payload.history) && payload.history.length > 0) {
    const existing = Array.isArray(current.history) ? current.history : [];
    const merged_hist = [...existing, ...payload.history].slice(-200);
    current = { ...current, ...payload, history: merged_hist, _lastWrite: new Date().toISOString() };
  } else {
    current = { ...current, ...payload, _lastWrite: new Date().toISOString() };
  }
  writeFileSync(STATE_SNAPSHOT, JSON.stringify(current, null, 2));
  appendFileSync(STATE_LOG, JSON.stringify({ ts: current._lastWrite, ...payload }) + "\n");
  return current;
}

app.get("/api/hello-zo", (c) => c.json({ msg: "Hello from Zo" }));

// Stats for console dashboard
app.get("/api/tru/stats", (c) => {
  let brain = 0;
  let kjv = 0;
  let sessionKeys = 0;
  if (existsSync(BRAIN_DB)) {
    try {
      const db = new Database(BRAIN_DB, { readonly: true });
      const row = db.prepare("SELECT COUNT(*) as n FROM nodes").get() as { n: number };
      brain = row.n;
      db.close();
    } catch {}
  }
  const kjvPath = join(process.cwd(), "..", "TRU", "kjv_lookup.json");
  if (existsSync(kjvPath)) {
    try {
      const k = JSON.parse(readFileSync(kjvPath, "utf8"));
      kjv = Object.keys(k).length;
    } catch {}
  }
  if (existsSync(STATE_SNAPSHOT)) {
    try {
      const s = JSON.parse(readFileSync(STATE_SNAPSHOT, "utf8"));
      sessionKeys = Object.keys(s).filter(k => k !== "_lastWrite").length;
    } catch {}
  }
  // Find latest ghost
  let lastBuild: string | undefined;
  let lastBuildBytes: number | undefined;
  let ghostPath: string | undefined;
  const ghostDir = join(process.cwd(), "..", "TRU", "ghost");
  if (existsSync(ghostDir)) {
    try {
      const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
      const files = readdirSync(ghostDir)
        .filter((f: string) => f.startsWith("TRU_HOLO_GHOST_") && f.endsWith(".html"))
        .map((f: string) => ({ f, m: statSync(join(ghostDir, f)).mtimeMs, s: statSync(join(ghostDir, f)).size }));
      files.sort((a, b) => b.m - a.m);
      if (files.length > 0) {
        ghostPath = join(ghostDir, files[0].f);
        lastBuildBytes = files[0].s;
        lastBuild = new Date(files[0].m).toISOString();
      }
    } catch {}
  }
  return c.json({ ok: true, brain, kjv, sessionKeys, lastBuild, lastBuildBytes, ghostPath });
});

// Tripwire status — confirms zo-api.ts is sealed
app.get("/api/tru/tripwire", (c) => {
  return c.json({
    ok: true,
    armed: true,
    mode: "SYNCHRONOUS_THROW",
    blocked_targets: ["api.zo.computer", "api.groq.com", "api.openai.com", "telemetry"],
    tripwire_module: "backend-lib/zo-api.ts",
  });
});

// Local ask — routes through baked brain. No external call.
app.post("/api/tru/ask", async (c) => {
  let body: { q?: string } = {};
  try { body = (await c.req.json()) as { q?: string }; } catch { return c.json({ ok: false, error: "invalid json" }, 400); }
  const q = (body.q || "").trim();
  if (!q) return c.json({ ok: false, error: "empty query" }, 400);
  ensureBrainDb();
  // Scripture shortcut
  const v = parseVerse(q);
  if (v) {
    const kjvPath = join(process.cwd(), "..", "TRU", "kjv_lookup.json");
    if (existsSync(kjvPath)) {
      try {
        const kjv = JSON.parse(readFileSync(kjvPath, "utf8")) as Record<string, string>;
        const refKey = v.key.toLowerCase().replace(/(\d+) /, "$1 ");
        const text = kjv[refKey] || kjv[v.key.toLowerCase()];
        if (text) return c.json({ ok: true, kind: "scripture", ref: v.key, text });
      } catch {}
    }
  }
  // Brain lookup
  if (existsSync(BRAIN_DB)) {
    try {
      const db = new Database(BRAIN_DB, { readonly: true });
      const qLower = q.toLowerCase();
      const row = db.prepare("SELECT k, v, t, source FROM nodes WHERE k = ? LIMIT 1").get(qLower) as { k: string; v: string; t: string; source: string } | undefined;
      if (row) { db.close(); return c.json({ ok: true, kind: "brain", k: row.k, v: row.v, t: row.t, source: row.source }); }
      // contains match on key
      const r2 = db.prepare("SELECT k, v, t, source FROM nodes WHERE k LIKE ? ORDER BY w DESC LIMIT 1").get(`%${qLower}%`) as { k: string; v: string; t: string; source: string } | undefined;
      if (r2) { db.close(); return c.json({ ok: true, kind: "brain", k: r2.k, v: r2.v, t: r2.t, source: r2.source }); }
      // contains match on value text — catches natural-language queries
      const r3 = db.prepare("SELECT k, v, t, source FROM nodes WHERE LOWER(v) LIKE ? ORDER BY w DESC LIMIT 1").get(`%${qLower}%`) as { k: string; v: string; t: string; source: string } | undefined;
      db.close();
      if (r3) return c.json({ ok: true, kind: "brain", k: r3.k, v: r3.v, t: r3.t, source: r3.source });
    } catch {}
  }
  return c.json({ ok: false, kind: "unknown", q, error: "no match" }, 404);
});

app.post("/api/tru/export", async (c) => {
  const raw = await c.req.text().catch(() => "");
  if (raw.length > MAX_EXPORT_BYTES) {
    return c.json({ ok: false, error: "payload too large" }, 413);
  }
  let body: Record<string, unknown>;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  try {
    const merged = mergeSnapshot(body);
    return c.json({ ok: true, ts: merged._lastWrite, path: STATE_SNAPSHOT });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

app.post("/api/tru/ghost", async (c) => {
  // Localhost only — this endpoint writes a file on disk.
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "local";
  if (ip && ip !== "127.0.0.1" && ip !== "::1" && ip !== "local") {
    return c.json({ ok: false, error: "ghost export is local-only" }, 403);
  }
  if (!existsSync(GHOST_BRAIN)) {
    return c.json({ ok: false, error: "brain file not found", path: GHOST_BRAIN }, 404);
  }
  try {
    const brain = JSON.parse(readFileSync(GHOST_BRAIN, "utf-8"));
    const kjv = existsSync(GHOST_KJV)
      ? JSON.parse(readFileSync(GHOST_KJV, "utf-8"))
      : {};
    const memory = existsSync(STATE_SNAPSHOT)
      ? JSON.parse(readFileSync(STATE_SNAPSHOT, "utf-8"))
      : {};

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    if (!existsSync(GHOST_DIR)) mkdirSync(GHOST_DIR, { recursive: true });
    const outPath = join(GHOST_DIR, `TRU_HOLO_GHOST_${ts}.html`);

    // The shell: same scripture engine logic as the site, but
    // BRAIN + KJV + SESSION are baked in. No fetch calls, no
    // external scripts. The file is sovereign.
    const shell = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>TRU · Ghost</title>
<style>
  body { background:#03030a; color:#e8e0d0; font-family:ui-monospace,monospace; margin:0; padding:24px; }
  #root { max-width: 780px; margin: 0 auto; }
  h1 { color:#d8a657; font-size: 22px; letter-spacing: 0.1em; }
  .sub { color:#4a4a5e; font-size: 11px; margin-bottom: 18px; }
  input { width:100%; padding:10px 14px; background:#0a0a14; border:1px solid #1a1a28; color:#e8e0d0; border-radius:6px; font:inherit; }
  .out { margin-top:18px; padding:12px 14px; border-left:3px solid #d8a657; background:rgba(216,166,87,0.04); }
  .verdict { font-size:10px; letter-spacing:0.12em; color:#d8a657; }
  .airgap { font-size:9px; color:#4a4a5e; letter-spacing:0.1em; margin-top:18px; text-align:center; }
</style>
</head>
<body>
<div id="root">
  <h1>TRU · GHOST</h1>
  <div class="sub">baked ${ts} · airgapped · file://</div>
  <input id="q" placeholder="Ask TRU..." autofocus>
  <div id="output"></div>
  <div class="airgap">NO TELEMETRY · NO NETWORK · NO CLOUD</div>
</div>
<script>
  const BRAIN = ${JSON.stringify(brain)};
  const KJV = ${JSON.stringify(kjv)};
  const SESSION = ${JSON.stringify(memory)};
  const STOP = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","is","was","are","be","have","has","do","does","did","will","would","not","no","so","if","it","that","this","i","you","what","when","where","why","all","some"]);
  const BOOK = { genesis:"gen",exodus:"ex",leviticus:"lev",numbers:"num",deuteronomy:"dt",psalms:"ps",psalm:"ps",proverbs:"prov",isaiah:"isa",jeremiah:"jer",ezekiel:"ezk",daniel:"dan",revelation:"rev",matthew:"mt",mark:"mk",luke:"lk",john:"jn",acts:"ac",romans:"rom","1corinthians":"1cor","2corinthians":"2cor",galatians:"gal",ephesians:"eph",philippians:"phil",colossians:"col","1thessalonians":"1thes","2thessalonians":"2thes","1timothy":"1tim","2timothy":"2tim",hebrews:"heb",james:"jas","1peter":"1pet","2peter":"2pet" };
  function tok(s){return (s||"").toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\\s+/).filter(w=>w.length>1&&!STOP.has(w));}
  function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;const d=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i?j?0:i:j));for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=a[i-1]===b[j-1]?d[i-1][j-1]:1+Math.min(d[i-1][j],d[i][j-1],d[i-1][j-1]);return d[m][n];}
  function score(n,q,r){const nw=tok(n.k+" "+n.v);let s=0;for(const w of q)if(nw.includes(w))s+=1;if(!s)return 0;const c=s/Math.max(q.length,1);return c*(n.w||0.5);}
  function verse(q){const m=q.match(/^([1-3]?\\s*[a-z]+)\\s+(\\d+)\\s*[:\\s]\\s*(\\d+)/i);if(!m)return null;const b=(BOOK[m[1].trim().toLowerCase().replace(/\\s+/g,"")])||m[1].trim().toLowerCase();const ref=b+" "+m[2]+":"+m[3];if(KJV[ref])return{ref,v:KJV[ref]};return null;}
  function lookup(q){const ql=q.toLowerCase().trim();const v=verse(ql);if(v)return{a:v.ref.toUpperCase()+" — "+v.v,t:"SCRIPTURE",s:100};const qt=tok(ql);if(!qt.length)return null;const hits=[];for(const n of BRAIN){const sc=score(n,qt,ql);if(sc>0.05)hits.push({n,sc});}hits.sort((a,b)=>b.sc-a.sc);if(!hits.length)return null;const top=hits[0];return{a:top.n.v,t:top.n.t||"TRUTH",s:Math.round(Math.min(top.sc*100,100))};}
  function render(){const q=document.getElementById("q").value;const r=lookup(q);const o=document.getElementById("output");if(!r){o.innerHTML='<div style="color:#4a4a5e">No match. Ask differently.</div>';return;}o.innerHTML='<div class="out"><div class="verdict">'+r.t+' · '+r.s+'%</div><div style="margin-top:8px;line-height:1.7">'+r.a+'</div></div>';}
  document.getElementById("q").addEventListener("keydown",function(e){if(e.key==="Enter")render();});
  // Restore session memory into the input on load
  if(SESSION&&SESSION.last_q)document.getElementById("q").value=SESSION.last_q;
</script>
</body></html>`;

    writeFileSync(outPath, shell, "utf-8");
    const { symlinkSync, unlinkSync, existsSync: existsSync2 } = require("node:fs") as typeof import("node:fs");
    const latestLink = join(GHOST_DIR, "TRU_HOLO_GHOST_LATEST.html");
    if (existsSync2(latestLink)) { try { unlinkSync(latestLink); } catch {} }
    try { symlinkSync(outPath, latestLink); } catch {}

    const stat = existsSync(outPath) ? readFileSync(outPath).length : 0;
    if (c.req.query("download") === "1") {
      const file = readFileSync(outPath, "utf-8");
      return new Response(file, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="TRU_HOLO_GHOST_${ts}.html"`,
          "content-length": String(file.length),
          "cache-control": "no-store",
        },
      });
    }
    return c.json({
      ok: true,
      path: outPath,
      bytes: stat,
      brain: Array.isArray(brain) ? brain.length : 0,
      kjv: Object.keys(kjv).length,
      session_keys: Object.keys(memory).length,
      ts,
    });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

app.get("/api/tru/state", (c) => {
  if (!existsSync(STATE_SNAPSHOT)) return c.json({ ok: true, empty: true });
  try {
    return c.json({ ok: true, snapshot: JSON.parse(readFileSync(STATE_SNAPSHOT, "utf8")) });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// BRAIN QUERY — read from SQLite
// ═══════════════════════════════════════════════════════════════
app.get("/api/tru/brain/:key", (c) => {
  const key = c.req.param("key");
  if (!existsSync(BRAIN_DB)) {
    return c.json({ ok: false, error: "brain.db not found" }, 404);
  }
  try {
    const db = new Database(BRAIN_DB);
    const row = db.prepare("SELECT * FROM nodes WHERE k = ?").get(key);
    db.close();
    if (!row) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, node: row });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

app.get("/api/tru/brain", (c) => {
  const q = c.req.query("q") || "";
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50")));
  if (!existsSync(BRAIN_DB)) {
    return c.json({ ok: false, error: "brain.db not found" }, 404);
  }
  try {
    const db = new Database(BRAIN_DB);
    let rows;
    if (q) {
      rows = db.prepare("SELECT * FROM nodes WHERE k LIKE ? OR v LIKE ? ORDER BY w DESC LIMIT ?")
        .all(`%${q}%`, `%${q}%`, limit);
    } else {
      rows = db.prepare("SELECT * FROM nodes ORDER BY w DESC LIMIT ?").all(limit);
    }
    db.close();
    return c.json({ ok: true, count: rows.length, nodes: rows });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// MONOLITH COMPILE — bake brain into a standalone HTML
// ═══════════════════════════════════════════════════════════════
app.get("/api/tru/compile", async (c) => {
  if (!existsSync(BRAIN_DB)) {
    return c.text("brain.db not found", 404);
  }
  try {
    const db = new Database(BRAIN_DB);
    const nodes = db.prepare("SELECT k, v, t, w, source, ref, greek_tr, greek_note, meta_json FROM nodes ORDER BY w DESC").all();
    db.close();

    const starterFacts: Record<string, string> = {};
    const greekNotes: Record<string, { tr: string; note: string }> = {};
    const brain: Array<{
      k: string;
      v: string;
      t?: string;
      w?: number;
      source?: string;
      ref?: string;
      greek_tr?: string;
      greek_note?: string;
      [key: string]: unknown;
    }> = [];

    for (const n of nodes) {
      const k = n.k as string;
      const v = n.v as string;
      const t = n.t as string | null;
      const w = n.w as number | null;
      const source = n.source as string | null;
      const ref = n.ref as string | null;
      const greek_tr = n.greek_tr as string | null;
      const greek_note = n.greek_note as string | null;
      const meta_json = n.meta_json as string | null;

      // STARTER_FACTS: top-level doctrinal entries (source=STARTER or t=fact)
      if (source === "STARTER" || (t === "fact" && !k.includes(":"))) {
        starterFacts[k] = v;
      }

      // GREEK_NOTES: greek_tr present
      if (greek_tr && greek_note) {
        greekNotes[greek_tr] = { tr: greek_tr, note: greek_note };
      }

      // Full brain entry
      const entry: Record<string, unknown> = { k, v };
      if (t) entry.t = t;
      if (w != null) entry.w = w;
      if (source) entry.source = source;
      if (ref) entry.ref = ref;
      if (greek_tr) entry.greek_tr = greek_tr;
      if (greek_note) entry.greek_note = greek_note;
      if (meta_json) {
        try {
          entry.meta = JSON.parse(meta_json);
        } catch {}
      }
      brain.push(entry as any);
    }

    // Read the shell HTML
    const shellPath = join(process.cwd(), "src/shell.html");
    let shell = existsSync(shellPath)
      ? readFileSync(shellPath, "utf8")
      : `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TRU</title>
</head>
<body>
  <div id="root"></div>
  <script>
    // BRAIN DATA — baked at compile time
    const EMBEDDED_BRAIN = {{BRAIN}};
    const STARTER_FACTS = {{STARTER}};
    const GREEK_NOTES = {{GREEK}};
  </script>
  <script>
    // CLIENT APP — minimal TRU shell
    const brain = EMBEDDED_BRAIN;
    const starter = STARTER_FACTS;
    const greek = GREEK_NOTES;
    const state = { history: [], visits: 0 };

    function lookup(q) {
      const key = q.toLowerCase().trim();
      if (starter[key]) return { v: starter[key], t: "fact", score: 100 };
      for (const n of brain) {
        if (n.k === key) return { v: n.v, t: n.t, score: 95, source: n.source };
      }
      return null;
    }

    function render() {
      const out = document.getElementById("output");
      const q = document.getElementById("q").value;
      const res = lookup(q);
      if (!res) {
        out.innerHTML = "<div style='color:#888'>No match. Ask something else.</div>";
        return;
      }
      out.innerHTML = "<div style='border-left:3px solid var(--truth,#44ddff);padding-left:12px'>" +
        "<div style='font-size:12px;letter-spacing:1px'>" + (res.t||"TRUTH") + " · " + res.score + "%" + (res.source?" · "+res.source:"") + "</div>" +
        "<div style='margin-top:8px;line-height:1.6'>" + res.v + "</div>" +
        "</div>";
      state.history.push({ q, a: res.v, ts: new Date().toISOString() });
      saveState();
    }

    function saveState() {
      // Post to export endpoint (non-blocking)
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/tru/export", JSON.stringify(state));
      }
    }

    window.addEventListener("beforeunload", saveState);
    window.addEventListener("pagehide", saveState);

    document.addEventListener("DOMContentLoaded", function() {
      document.getElementById("q").focus();
      document.getElementById("q").addEventListener("keydown", function(e) {
        if (e.key === "Enter") render();
      });
    });
  </script>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0f; color: #eee; margin: 0; padding: 24px; }
    #root { max-width: 720px; margin: 0 auto; }
    h1 { font-size: 32px; margin: 0 0 8px; letter-spacing: -0.5px; }
    .sub { font-size: 11px; color: #888; margin-bottom: 24px; }
    input#q { width: 100%; padding: 12px 16px; font-size: 16px; background: #1a1a1f; border: 1px solid #333; color: #eee; border-radius: 6px; box-sizing: border-box; }
    input#q:focus { outline: none; border-color: #44ddff; }
    #output { margin-top: 20px; }
  </style>
</body>
<body>
  <div id="root">
    <h1>TRU</h1>
    <div class="sub">monolith · brain: {{COUNT}} nodes</div>
    <input id="q" type="text" placeholder="Ask TRU..." autofocus>
    <div id="output"></div>
  </div>
</body>
</html>`;

    // Inject data
    const brainJson = JSON.stringify(brain);
    const starterJson = JSON.stringify(starterFacts, null, 2);
    const greekJson = JSON.stringify(greekNotes, null, 2);

    shell = shell
      .replace("{{BRAIN}}", brainJson)
      .replace("{{STARTER}}", starterJson)
      .replace("{{GREEK}}", greekJson)
      .replace("{{COUNT}}", String(brain.length));

    // Save to state folder
    const outPath = join(STATE_DIR, "TRU_monolith.html");
    writeFileSync(outPath, shell);

    return c.json({
      ok: true,
      path: outPath,
      stats: {
        brain: brain.length,
        starter: Object.keys(starterFacts).length,
        greek: Object.keys(greekNotes).length,
      },
    });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

if (mode === "production") {
  configureProduction(app);
} else {
  await configureDevelopment(app);
}

const port = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : mode === "production"
    ? (config.publish?.published_port ?? config.local_port)
    : config.local_port;

export default { fetch: app.fetch, port, idleTimeout: 255 };

function configureProduction(app: Hono) {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 302));
  app.use(async (c, next) => {
    if (c.req.method !== "GET") return next();
    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/assets/")) return next();
    const file = Bun.file(`./dist${path}`);
    if (await file.exists()) {
      const stat = await file.stat();
      if (stat && !stat.isDirectory()) {
        return new Response(file);
      }
    }
    return serveStatic({ path: "./dist/index.html" })(c, next);
  });
}

async function configureDevelopment(app: Hono): Promise<ViteDevServer> {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    if (c.req.path === "/favicon.ico") return c.redirect("/favicon.svg", 302);
    const url = c.req.path;
    try {
      if (url === "/" || url === "/index.html") {
        let template = await Bun.file("./index.html").text();
        template = await vite.transformIndexHtml(url, template);
        return c.html(template, { headers: { "Cache-Control": "no-store, must-revalidate" } });
      }
      const publicFile = Bun.file(`./public${url}`);
      if (await publicFile.exists()) {
        const stat = await publicFile.stat();
        if (stat && !stat.isDirectory()) {
          return new Response(publicFile, { headers: { "Cache-Control": "no-store, must-revalidate" } });
        }
      }
      let result;
      try { result = await vite.transformRequest(url); } catch { result = null; }
      if (result) {
        return new Response(result.code, {
          headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store, must-revalidate" },
        });
      }
      let template = await Bun.file("./index.html").text();
      template = await vite.transformIndexHtml("/", template);
      return c.html(template, { headers: { "Cache-Control": "no-store, must-revalidate" } });
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      console.error(error);
      return c.text("Internal Server Error", 500);
    }
  });
  return vite;
}
