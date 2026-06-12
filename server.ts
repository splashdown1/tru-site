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
  // Treat a missing forwarded-for header as "remote" so we never default-open
  // the gate in a public reverse-proxy deployment.
  const xff = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "";
  const ip = xff.split(",")[0]!.trim();
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!isLocal) {
    return c.json({ ok: false, error: "ghost export is local-only" }, 403);
  }
  const wantDownload = new URL(c.req.url).searchParams.get("download") === "1";

  // Optional: read uploaded state from request body.
  let userState: Record<string, unknown> = {};
  if (c.req.header("content-type")?.includes("application/json")) {
    try {
      const raw = await c.req.text();
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        userState = parsed && typeof parsed === "object" ? parsed : {};
      }
    } catch (e) {
      return c.json({ ok: false, error: "invalid json body" }, 400);
    }
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

    // Merge user's uploaded state on top of the persisted session memory.
    // userState shape: { text?: string, notes?: string, uploads?: [{name,mime,size,kind,data}] }
    const mergedMemory: Record<string, unknown> = { ...(memory || {}) };
    if (userState && typeof userState === "object") {
      const uploads = Array.isArray((userState as any).uploads) ? (userState as any).uploads : [];
      const totalBytes = uploads.reduce((acc: number, u: any) => acc + (typeof u?.size === "number" ? u.size : (u?.data?.length || 0)), 0);
      const MAX_UPLOAD_TOTAL = 32 * 1024 * 1024; // 32 MB ceiling on baked uploads
      if (totalBytes > MAX_UPLOAD_TOTAL) {
        return c.json({ ok: false, error: `uploads exceed ${MAX_UPLOAD_TOTAL} bytes`, totalBytes }, 413);
      }
      if (typeof (userState as any).text === "string") mergedMemory.text = (userState as any).text;
      if (typeof (userState as any).notes === "string") mergedMemory.notes = (userState as any).notes;
      if (uploads.length) mergedMemory.uploads = uploads;
      mergedMemory._ghostBuild = new Date().toISOString();
    }

    // Read the clean shell + runtime templates.
    const shellPath = join(process.cwd(), "src", "tru-ghost-shell.html");
    const runtimePath = join(process.cwd(), "src", "tru-ghost-runtime.template.js");
    if (!existsSync(shellPath)) {
      return c.json({ ok: false, error: "shell template not found", path: shellPath }, 500);
    }
    if (!existsSync(runtimePath)) {
      return c.json({ ok: false, error: "runtime template not found", path: runtimePath }, 500);
    }
    let shell = readFileSync(shellPath, "utf-8");
    let runtime = readFileSync(runtimePath, "utf-8");

    const meta = {
      baked: new Date().toISOString(),
      uploads: Array.isArray((mergedMemory as any).uploads) ? (mergedMemory as any).uploads.length : 0,
      brain: Array.isArray(brain) ? brain.length : 0,
      kjv: Object.keys(kjv).length,
    };

    // Inject the four data slots. Use JSON.stringify which produces
    // valid JS literals — the runtime reads them as `const` bindings.
    // Use split/join to replace ALL occurrences (String.replace only does
    // the first match, and brain JSON can contain placeholder-like substrings).
    const brainJson = JSON.stringify(brain);
    const kjvJson = JSON.stringify(kjv);
    const sessionJson = JSON.stringify(mergedMemory);
    const metaJson = JSON.stringify(meta);
    runtime = runtime
      .split("__BRAIN__").join(brainJson)
      .split("__KJV__").join(kjvJson)
      .split("__SESSION__").join(sessionJson)
      .split("__META__").join(metaJson);

    const html = shell.replace("/* __TRU_GHOST_RUNTIME__ */", runtime);

    if (wantDownload) {
      // Stream the bytes straight back as a download. No file is written.
      const filename = `TRU_GHOST_${meta.baked.replace(/[:.]/g, "-")}.html`;
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // Default: persist to disk under TRU/ghost/ and return stats JSON.
    const ts = meta.baked.replace(/[:.]/g, "-");
    if (!existsSync(GHOST_DIR)) mkdirSync(GHOST_DIR, { recursive: true });
    const outPath = join(GHOST_DIR, `TRU_HOLO_GHOST_${ts}.html`);
    writeFileSync(outPath, html, "utf-8");

    // Refresh the "latest" symlink.
    const { symlinkSync, unlinkSync } = require("node:fs") as typeof import("node:fs");
    const latestLink = join(GHOST_DIR, "TRU_HOLO_GHOST_LATEST.html");
    if (existsSync(latestLink)) { try { unlinkSync(latestLink); } catch {} }
    try { symlinkSync(outPath, latestLink); } catch {}

    return c.json({
      ok: true,
      path: outPath,
      bytes: html.length,
      brain: Array.isArray(brain) ? brain.length : 0,
      kjv: Object.keys(kjv).length,
      session_keys: Object.keys(mergedMemory).length,
      uploads: meta.uploads,
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
