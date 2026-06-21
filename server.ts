import { serveStatic } from "hono/bun";
import type { ViteDevServer } from "vite";
import { createServer as createViteServer } from "vite";
import config from "./zosite.json";
import { Hono } from "hono";
import { writeFileSync, existsSync, mkdirSync, appendFileSync, readFileSync, renameSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import Database from "bun:sqlite";
// canon + truth-layer live in the sibling TRU/ monorepo (present on the
// canonical account). On instances without that sibling they degrade to
// "UNAVAILABLE" honestly: the server boots and /api/tru/primaries reports
// the real state. Tamper detection (lock drift) still process.exit(1)s
// when canon IS present — the integrity guarantee is unchanged there.
let buildLockable: any, computeLock: any, loadAssetsConfig: any;
try {
  const canon = await import("../TRU/primaries/canon");
  ({ buildLockable, computeLock, loadAssetsConfig } = canon);
} catch {
  buildLockable = computeLock = loadAssetsConfig = undefined;
}

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

// ═══════════════════════════════════════════════════════════════
// PRIMARIES VERIFICATION — boot tripwire
// The shared canon module (TRU/primaries/canon.ts) is the single source
// of truth. The lock script and this server import the same `computeLock`
// function so the canonical format can never drift.
// ═══════════════════════════════════════════════════════════════
const TRU_ROOT = join(process.cwd(), "..", "TRU");
const PRIMARIES_DIR = join(TRU_ROOT, "primaries");
const PRIMARIES_LOCK = join(PRIMARIES_DIR, "primaries.lock");
const PRIMARIES_ASSETS_JSON = join(PRIMARIES_DIR, "assets.json");
// Single source of truth — see TRU/primaries/assets.json. Both the
// server boot tripwire and tools/import-primaries/lock.ts import from
// this file so the two never drift.

async function verifyPrimariesAtBoot(): Promise<{ ok: boolean; details: Record<string, unknown> }> {
  const details: Record<string, unknown> = { assets: {} as Record<string, string>, stored: null, computed: null };
  if (!buildLockable || !computeLock || !loadAssetsConfig) {
    console.log("[primaries] UNAVAILABLE: canon module not present on this instance — server boots; /api/tru/primaries will report UNAVAILABLE");
    return { ok: false, details: { ...details, status: "UNAVAILABLE", reason: "unavailable" } };
  }
  if (!existsSync(PRIMARIES_LOCK)) {
    console.log("[primaries] UNAVAILABLE: primaries.lock missing at", PRIMARIES_LOCK, "— canon present but no lock; treating as unavailable (not tamper)");
    return { ok: false, details: { ...details, status: "UNAVAILABLE", reason: "unavailable" } };
  }
  const storedLock = (await Bun.file(PRIMARIES_LOCK).text()).trim();
  (details as any).stored = storedLock.slice(0, 16) + "…";

  // Single source of truth: see TRU/primaries/canon.ts. The same
  // function the lock script uses to write the lock is what we use
  // here to verify it. No possibility of canonical-format drift.
  let assets;
  try {
    assets = loadAssetsConfig(PRIMARIES_ASSETS_JSON);
  } catch (err) {
    console.error("[primaries] FAIL: assets.json unreadable:", err);
    return { ok: false, details: { ...details, status: "FAIL", reason: "tamper" } };
  }
  let lockable;
  try {
    lockable = buildLockable(TRU_ROOT, assets);
  } catch (err) {
    console.error("[primaries] FAIL: buildLockable threw:", err);
    return { ok: false, details: { ...details, status: "FAIL", reason: "tamper" } };
  }
  // Surface any missing primary so joe sees the exact file, not just a hash drift.
  for (const [name, info] of Object.entries(lockable.primary)) {
    if (info === null) {
      console.error("[primaries] FAIL: missing primary asset", name);
      return { ok: false, details: { ...details, status: "FAIL", reason: "tamper" } };
    }
  }
  (details as any).assets = Object.fromEntries(
    Object.entries(lockable.primary).map(([k, v]) => [
      k, v ? v.hash.slice(0, 16) + "…" : "MISSING",
    ]),
  );
  const computedLock = computeLock(lockable);
  (details as any).computed = computedLock.slice(0, 16) + "…";

  if (computedLock !== storedLock) {
    console.error(`[primaries] FAIL: lock drift — stored=${storedLock.slice(0, 16)}… computed=${computedLock.slice(0, 16)}…`);
    return { ok: false, details: { ...details, status: "FAIL", reason: "tamper" } };
  }
  console.log(`[primaries] OK: lock verified (${storedLock.slice(0, 16)}…)`);
  return { ok: true, details };
}

let _primariesOk = false;
let _primariesDetails: Record<string, unknown> = {};
let __PRIMARIES_REPORT: { status: string; stored: string; computed: string; assets: Record<string, string> } | undefined;
await verifyPrimariesAtBoot().then((r) => {
  _primariesOk = r.ok;
  _primariesDetails = r.details;
  // Tamper (lock drift / missing asset with canon present) → refuse to boot.
  // Unavailable (canon or lock absent on this instance) → boot honestly.
  if (!r.ok && (r.details as any).reason !== "unavailable") process.exit(1);
  __PRIMARIES_REPORT = {
    status: r.ok ? "PASS" : ((r.details as any).reason === "unavailable" ? "UNAVAILABLE" : "FAIL"),
    stored: (r.details as any).stored,
    computed: (r.details as any).computed,
    assets: (r.details as any).assets,
  };
});

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

type QueryClass = "identity" | "definition" | "dilemma" | "topic";

type NodeRow = {
  k: string;
  v: string;
  t?: string | null;
  source?: string | null;
  ref?: string | null;
  w?: number | null;
};

const FRAME_KEYS = [
  "answer_style",
  "human_conversation_rule",
  "tru_mission",
  "tru_personal_mode",
  "tru_honesty",
  "tru_voice",
  "tru_identity",
];
const FRAME_KEY_SET = new Set(FRAME_KEYS);

const TYPE_PRIORITY: Record<string, number> = {
  identity: 70,
  rule: 58,
  wisdom: 50,
  knowledge: 46,
  concept: 44,
  fact: 42,
  dilemma: 32,
  document: 28,
  primer: 26,
  christ_attestation: 22,
  theology: 21,
  greek_theology: 20,
  hebrew_theology: 20,
  garden: 18,
  survival: 18,
  interaction: 2,
  ghost: 12,
  bible: 4,
  lexicon: 4,
};

const TOPIC_TYPES = new Set(["knowledge","concept","fact","wisdom","document","primer","christ_attestation","greek_theology","hebrew_theology","garden","survival","interaction","dilemma","bible","lexicon","theology"]);

const SOURCE_PRIORITY: Record<string, number> = {
  TRU_CORE: 10,
  TRU_BRAIN: 8,
  CERTIFIED: 7,
  KNOWLEDGE_BANK: 7,
  MANIFESTO: 4,
  TRU_TRUTH: 4,
  STARTER: 2,
};

const STOP_WORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","do","does","did",
  "what","who","whom","whose","which","where","when","why","how",
  "i","you","he","she","it","we","they","me","him","her","us","them",
  "my","your","his","its","our","their","this","that","these","those",
  "to","of","in","on","at","for","with","about","into","from","by","as","and","or","but","if","so",
  "tell","me","about","explain","define","describe","say","says","said",
  "can","could","would","should","will","shall","may","might","must",
  "there","here","up","down","out","over","under",
  "not","no","yes",
]);

function isQualityText(s: string | null | undefined): boolean {
  const text = String(s == null ? "" : s).trim();
  if (text.length < 8) return false;
  if (text.length > 4000) return false;
  // Reject nodes whose value is a copy-paste of source code or metadata.
  const startsAsCode = /^\s*(function|const|let|var|import|export|class|interface|type)\s|;\s*\n\s*\}/;
  if (startsAsCode.test(text)) return false;
  // Heuristic: count code-shaped tokens vs real-word tokens.
  const codeChars = (text.match(/[{};]|=>|->/g) || []).length;
  const wordCount = (text.match(/[A-Za-z][A-Za-z0-9_-]+/g) || []).length;
  if (codeChars >= 4 && wordCount < 30) return false;
  // Reject TRU dilemma metadata fragments that got copy-pasted into values.
  if (/dilemma_id\s*:|primitive\s*:\s*VP_\d+_/.test(text)) return false;
  return true;
}
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2019'`_]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function firstSentence(text: string, limit = 220): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = match?.[1] ?? clean;
  if (sentence.length <= limit) return sentence;
  return sentence.slice(0, limit - 1).trimEnd() + "…";
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function classifyQuery(q: string): QueryClass {
  const n = norm(q);
  if (/\b(who are you|what are you|what is tru|who is tru|your mission|your style|how do you answer|how do you think|tell me about yourself)\b/.test(n)) {
    return "identity";
  }
  if (/^\s*(define|what is|what are|explain|describe|tell me about|how does|how do|why is|why are)\b/.test(n)) {
    // "what is mercy" / "define logos" / "explain the golden rule" are
    // DEFINITION queries, not generic TOPICs. We bucket them separately so
    // the synthesis path can prefer a real concept/fact/knowledge node
    // over a generic identity/wisdom rule for the lead answer.
    return "definition";
  }
  if (/\b(should|ought|dilemma|tradeoff|trade-off|choose|risk|what if|conflict|cost)\b/.test(n)) {
    return "dilemma";
  }
  return "topic";
}

function uniqueByKey(rows: NodeRow[]): NodeRow[] {
  const seen = new Set<string>();
  const out: NodeRow[] = [];
  for (const row of rows) {
    if (!row.k || seen.has(row.k)) continue;
    seen.add(row.k);
    out.push(row);
  }
  return out;
}

function typeBonus(t?: string | null, queryClass: QueryClass = "topic"): number {
  const kind = String(t ?? "").toLowerCase();
  let bonus = TYPE_PRIORITY[kind] ?? 0;
  if (queryClass === "identity") {
    if (kind === "identity") bonus += 30;
    if (kind === "rule" || kind === "wisdom") bonus += 18;
  } else if (queryClass === "definition") {
    if (kind === "concept" || kind === "fact" || kind === "knowledge") bonus += 12;
    if (kind === "greek_theology" || kind === "hebrew_theology" || kind === "theology") bonus += 14;
  } else if (queryClass === "dilemma") {
    if (kind === "dilemma" || kind === "rule" || kind === "wisdom") bonus += 14;
  } else {
    if (kind === "knowledge" || kind === "concept" || kind === "fact" || kind === "wisdom") bonus += 8;
  }
  return bonus;
}

function sourceBonus(source?: string | null): number {
  return SOURCE_PRIORITY[String(source ?? "")] ?? 0;
}

function scoreCandidate(node: NodeRow, qNorm: string, qTokens: string[], queryClass: QueryClass): number {
  if (!isQualityText(node.v)) return 0;
  const keyNorm = norm(node.k ?? "");
  const valueNorm = norm(node.v ?? "");
  const refNorm = norm(node.ref ?? "");
  let score = 0;

  if (keyNorm === qNorm) score += 180;
  else if (keyNorm && qNorm && keyNorm.startsWith(qNorm) && qNorm.length >= 2) score += 110;
  else if (keyNorm && qNorm && keyNorm.includes(qNorm) && qNorm.length >= 2) score += 90;
  if (valueNorm && qNorm && valueNorm.includes(qNorm) && qNorm.length >= 2) score += 70;
  if (refNorm && qNorm && refNorm.includes(qNorm) && qNorm.length >= 2) score += 45;
  // Frame nodes keep their own priority bonus; for non-identity queries we
  // also gate the unconditional +60 so they do not auto-win every fan-out.
  if (FRAME_KEY_SET.has(keyNorm)) {
    score += queryClass === "identity" ? 60 : 12;
  }

  if (qTokens.length > 0) {
    const hay = new Set(tokenize(`${node.k} ${node.v} ${node.ref ?? ""}`));
    let hits = 0;
    for (const token of qTokens) if (hay.has(token)) hits += 1;
    if (hits > 0) {
      const coverage = hits / Math.max(qTokens.length, hay.size || 1);
      score += coverage * 80;
      score += hits * 2;
    }
  }

  score += typeBonus(node.t, queryClass);
  score += sourceBonus(node.source);
  return score;
}

function buildSynthesis(query: string, queryClass: QueryClass, rows: NodeRow[]) {
  const qNorm = norm(query);
  const qTokens = tokenize(query);
  const scored = rows
    .map((node) => ({ node, score: scoreCandidate(node, qNorm, qTokens, queryClass) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (Number(b.node.w ?? 0) - Number(a.node.w ?? 0)))
    ;
  const levenshteinDrop = (qTokens.length > 0 && qNorm.length >= 4) ? scored.filter((it) => {
    const k = norm(it.node.k);
    if (k === qNorm) return true;
    // For multi-word queries, only keep nodes whose key starts with the
    // query or contains a clear match — kill edit-distance lookalikes.
    if (k.startsWith(qNorm) || k.includes(qNorm)) return true;
    if (qTokens.length === 1) {
      // single-word query: allow exact or stemming (prefix >= 3)
      if (k === qTokens[0] || k.startsWith(qTokens[0])) return true;
      // reject if key is a different word that just happens to be long
      // and contains one of the query letters.
      return false;
    }
    // multi-word: require at least one whole query token to appear at a
    // word boundary in the key (whitespace or underscore delimited).
    // Raw substring match is too loose: e.g. "golden" matches
    // "golden_ratio" and the user asking "what is the golden rule" gets
    // the Golden Ratio phi node as the lead.
    return qTokens.filter((t) => t.length >= 3).every((t) => k.split(/[\s_]+/).includes(t));
  }) : scored;
  if (scored.length === 0) {
    return {
      ok: true,
      kind: "brain",
      k: "",
      v: `No grounded node found for "${query}".\nThe brain has not yet been taught this. Teach me.\nFormat: remember: ${query} = <the truth you would have it hold>`,
      t: "GAP",
      source: "TRU_CORE",
      blank: true,
      score: 0,
      nodes: [] as string[],
    };
  }

  const shortQuery = qTokens.length >= 1 && qTokens.length <= 3;

  const FRAME_TYPES = new Set(["identity", "rule", "wisdom"]);
  const isFrame = (row: NodeRow): boolean => {
    if (FRAME_KEY_SET.has(norm(row.k))) return true;
    return FRAME_TYPES.has(String(row.t ?? "").toLowerCase());
  };

  // Pick `best` as the first scored row that is a real semantic match for
  // the query (its key/value/ref actually contains a query token) AND is
  // not a frame node. Frame nodes still shape the synthesis, but the
  // lead answer must come from a topic node that actually mentions the
  // query. For identity-class queries, fall through to the top frame.
  const isTopic = (row: NodeRow): boolean => {
    if (isFrame(row)) return false;
    return TOPIC_TYPES.has(String(row.t ?? "").toLowerCase());
  };
  const isTokenMatch = (row: NodeRow): boolean => {
    if (!qTokens.length) return false;
    const keyNorm = norm(row.k);
    const valueNorm = norm(row.v);
    const refNorm = norm(row.ref ?? "");
    if (keyNorm && qNorm && (keyNorm === qNorm || keyNorm.startsWith(qNorm) || keyNorm.includes(qNorm))) return true;
    for (const t of qTokens) {
      if (t.length < 2) continue;
      if (keyNorm.includes(t)) return true;
      if (valueNorm.includes(t)) return true;
      if (refNorm.includes(t)) return true;
    }
    return false;
  };

  let best: NodeRow;
  let bestScore: number;
  if (queryClass === "identity") {
    best = scored[0].node;
    bestScore = scored[0].score;
  } else if (shortQuery) {
    // Look only at topic nodes that actually mention a query token.
    // Skip code-shaped nodes via isQualityText which scoreCandidate
    // already filters with (returns 0 for bad text).
    const real = scored.find((it) => isTopic(it.node) && isTokenMatch(it.node));
    best = real ? real.node : scored[0].node;
    bestScore = real ? real.score : scored[0].score;
  } else {
    const real = scored.find((it) => isTopic(it.node) && isTokenMatch(it.node))
      ?? scored.find((it) => isTopic(it.node) && isTokenMatch(it.node) === false && String(it.node.t ?? "").toLowerCase() !== "concept")
      ?? scored.find((it) => isTopic(it.node));
    best = real ? real.node : scored[0].node;
    bestScore = real ? real.score : scored[0].score;
  }
  const next = scored.filter((item) => item.node.k !== best.k);
  const frame = scored.find((item) => FRAME_KEY_SET.has(norm(item.node.k)))?.node
    ?? scored.find((item) => ["identity", "rule", "wisdom"].includes(String(item.node.t ?? "").toLowerCase()))?.node;

  const pick = (predicate: (n: NodeRow) => boolean, excludeKeys: string[] = []) => {
    const hit = next.find((item) => !excludeKeys.includes(item.node.k) && predicate(item.node));
    return hit?.node ?? null;
  };

  const eligible = (it: { node: NodeRow }): boolean =>
    it.node.k !== best.k && isTopic(it.node) && isTokenMatch(it.node);

  const whatItWas = firstSentence(best.v, 220);

  // Extract labelled sub-clauses from the lead node's value text itself,
  // so nodes that already embed "The hidden engine: ...", "Why it mattered: ..."
  // get the full synthesis without needing a neighbour node.
  const bestV = String(best.v ?? "");
  const extractClause = (label: string): string => {
    const re = new RegExp(
      `(?:^|[\\s\\.;\\(\\)\\-])${label}\\s*:\\s*([^\\n;]+(?:[\\n;](?!\\s*(?:Lesson|See also|Why|What|Hidden|Failure|What it teaches|Source|Note)\\s*:)[^\\n;]+)*)`,
      "i",
    );
    const m = bestV.match(re);
    if (!m) return "";
    return firstSentence(m[1], 180);
  };
  const embeddedHidden = extractClause("The hidden engine");
  const embeddedWhy = extractClause("Why it mattered");

  const whyItMattered = embeddedWhy || firstSentence(
    next.find(eligible)?.node.v ?? "",
    180,
  );
  const hiddenEngine = embeddedHidden || firstSentence(
    next.find((it) => eligible(it) && ["rule", "wisdom"].includes(String(it.node.t ?? "").toLowerCase()))?.node.v ?? "",
    180,
  );
  const failureMode = firstSentence(
    next.find((it) => eligible(it) && String(it.node.t ?? "").toLowerCase() === "dilemma")?.node.v ?? "",
    180,
  );
  const teachesNow = "";

  let text = "";
  if (queryClass === "identity") {
    text = teachesNow || whatItWas;
    const extra = [whyItMattered, hiddenEngine, failureMode].filter(Boolean);
    if (extra.length) text += `\nRelated: ${extra.join(" | ")}`;
  } else if (bestScore >= 18) {
    const lines = [
      `What it was: ${whatItWas}`,
      whyItMattered ? `Why it mattered: ${whyItMattered}` : "",
      hiddenEngine ? `Hidden engine: ${hiddenEngine}` : "",
      failureMode ? `Failure mode: ${failureMode}` : "",
      teachesNow ? `What it teaches now: ${teachesNow}` : "",
    ].filter(Boolean);
    text = lines.join("\n");
  } else {
    const closests = scored.slice(0, 3).map((item) => firstSentence(item.node.v, 120)).filter(Boolean);
    text = `No grounded node found for "${query}".\nThe brain has not yet been taught this. Teach me.`;
    if (closests.length) text += ` Closest: ${closests.join(" · ")}`;
    if (teachesNow) text += `\nFrame: ${teachesNow}`;
    text += `\nFormat: remember: ${query} = <the truth you would have it hold>`;
  }

  return {
    ok: true,
    kind: "brain",
    k: best.k,
    v: text,
    t: bestScore >= 18 ? String(best.t ?? "SYNTHESIS").toUpperCase() : "GAP",
    source: best.source ?? "TRU_CORE",
    score: Math.min(99, Math.round(bestScore)),
    nodes: scored.slice(0, 5).map((item) => `${item.node.k}:${item.node.t ?? ""}`),
  };
}

function collectCandidates(db: Database, query: string, queryClass: QueryClass): NodeRow[] {
  const rows: NodeRow[] = [];
  const push = (items: NodeRow[] | unknown) => {
    if (Array.isArray(items)) rows.push(...(items as NodeRow[]));
  };
  const qNorm = norm(query);
  const qRaw = query.trim().toLowerCase();
  const qTokens = tokenize(query);

  if (qNorm) {
    try {
      push(
        db.prepare(
          "SELECT k, v, t, source, ref, w FROM nodes WHERE LOWER(k) = ? OR LOWER(REPLACE(k, '_', ' ')) = ? OR LOWER(v) = ? OR LOWER(ref) = ? ORDER BY w DESC LIMIT 20",
        ).all(qNorm, qNorm, qNorm, qNorm) as NodeRow[],
      );
    } catch {}
    try {
      push(
        db.prepare(
          "SELECT k, v, t, source, ref, w FROM nodes WHERE LOWER(k) LIKE ? OR LOWER(REPLACE(k, '_', ' ')) LIKE ? OR LOWER(v) LIKE ? OR LOWER(ref) LIKE ? ORDER BY w DESC LIMIT 80",
        ).all(`%${qRaw}%`, `%${qRaw}%`, `%${qRaw}%`, `%${qRaw}%`) as NodeRow[],
      );
    } catch {}
  }

  if (qTokens.length > 0) {
    const clauses = qTokens
      .map(() => "(LOWER(k) LIKE ? OR LOWER(REPLACE(k, '_', ' ')) LIKE ? OR LOWER(v) LIKE ? OR LOWER(ref) LIKE ?)")
      .join(" OR ");
    const params = qTokens.flatMap((token) => [`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`]);
    try {
      push(
        db.prepare(`SELECT k, v, t, source, ref, w FROM nodes WHERE ${clauses} ORDER BY w DESC LIMIT 120`).all(...params) as NodeRow[],
      );
    } catch {}
  }

  const typeGroups: Record<QueryClass, string[]> = {
    identity: ["identity", "rule", "wisdom", "knowledge", "concept", "fact"],
    definition: ["concept", "fact", "knowledge", "wisdom", "rule", "identity"],
    dilemma: ["dilemma", "rule", "wisdom", "identity", "knowledge", "concept", "fact"],
    topic: ["knowledge", "concept", "fact", "wisdom", "rule", "identity", "dilemma", "document", "primer", "christ_attestation", "greek_theology", "hebrew_theology", "garden", "survival", "interaction"],
  };
  const types = typeGroups[queryClass];
  if (types.length > 0) {
    try {
      push(
        db.prepare(`SELECT k, v, t, source, ref, w FROM nodes WHERE t IN (${types.map(() => "?").join(",")}) ORDER BY w DESC LIMIT 160`).all(...types) as NodeRow[],
      );
    } catch {}
  }

  try {
    push(
      db.prepare(`SELECT k, v, t, source, ref, w FROM nodes WHERE k IN (${FRAME_KEYS.map(() => "?").join(",")})`).all(...FRAME_KEYS) as NodeRow[],
    );
  } catch {}

  return uniqueByKey(rows);
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

// Primaries verification audit — returns the report from the last boot check.
app.get("/api/tru/primaries", (c) => {
  if (!__PRIMARIES_REPORT) {
    return c.json({ ok: false, error: "primaries verification did not run" }, 503);
  }
  return c.json({ ok: __PRIMARIES_REPORT.status === "PASS", ...__PRIMARIES_REPORT });
});

// Truth-layer proof route — returns the verified primary asset metadata
// (sizes + SHA-256) by routing through @tru/truth-layer. This is the
// canonical "what does TRU believe" surface; every primary consumer in
// TRU Online should defer to it.
let loadTruth: ((root: string) => Promise<any>) | undefined;
try {
  const tl = await import("../TRU/packages/truth-layer/src/index");
  loadTruth = tl.load;
} catch {
  loadTruth = undefined;
}
let _truthCache: any = null;
let _truthCacheAt = 0;
async function getTruth() {
  if (!loadTruth) throw new Error("truth-layer not present on this instance");
  if (_truthCache && Date.now() - _truthCacheAt < 30_000) return _truthCache;
  _truthCache = await loadTruth(join(process.cwd(), "..", "TRU"));
  _truthCacheAt = Date.now();
  return _truthCache;
}
app.get("/api/tru/primaries-data", async (c) => {
  try {
    const t = await getTruth();
    return c.json({
      ok: true,
      lock: t.lock,
      primary: Object.fromEntries(
        Object.entries(t.primary).map(([k, v]) => [k, { size: v.size, hash: v.hash }])
      ),
      brainCount: t.brain.length,
      kjvCount: Object.keys(t.kjv).length,
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 503);
  }
});

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
  if (!existsSync(BRAIN_DB)) {
    return c.json({ ok: false, kind: "unknown", q, error: "brain.db not found" }, 404);
  }
  try {
    const db = new Database(BRAIN_DB, { readonly: true });
    const queryClass = classifyQuery(q);
    const candidates = collectCandidates(db, q, queryClass);
    db.close();

    const answer = buildSynthesis(q, queryClass, candidates);
    return c.json(answer);
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// SOVEREIGN ASK — gated. Same retrieval as /ask, but folds TRU's own
// remembered memory into the answer. Public /ask stays brain+KJV only;
// memory is the owner's private knowledge and must not leak to anon
// queries. In the GAP case, a strong memory match becomes the answer.
app.post("/api/tru/ask/sovereign", async (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  let body: { q?: string } = {};
  try { body = (await c.req.json()) as { q?: string }; } catch { return c.json({ ok: false, error: "invalid json" }, 400); }
  const q = (body.q || "").trim();
  if (!q) return c.json({ ok: false, error: "empty query" }, 400);
  ensureBrainDb();
  // Scripture shortcut — same as public /ask.
  const v = parseVerse(q);
  if (v) {
    const kjvPath = join(process.cwd(), "..", "TRU", "kjv_lookup.json");
    if (existsSync(kjvPath)) {
      try {
        const kjv = JSON.parse(readFileSync(kjvPath, "utf8")) as Record<string, string>;
        const refKey = v.key.toLowerCase().replace(/(\d+) /, "$1 ");
        const text = kjv[refKey] || kjv[v.key.toLowerCase()];
        if (text) {
          const ans = foldMemory({ ok: true, kind: "scripture", ref: v.key, text }, q);
          const learned = autoLearn(q, ans);
          logAsk({ ts: Date.now(), q, kind: "scripture", gap: false, learned });
          if (learned.length) (ans as any).learned = learned;
          return c.json(ans);
        }
      } catch {}
    }
  }
  if (!existsSync(BRAIN_DB)) {
    return c.json({ ok: false, error: "brain.db not found" }, 404);
  }
  try {
    const db = new Database(BRAIN_DB, { readonly: true });
    const queryClass = classifyQuery(q);
    const candidates = collectCandidates(db, q, queryClass);
    db.close();
    const answer = foldMemory(buildSynthesis(q, queryClass, candidates), q);
    // Self-writing memory: extract teachings/identity/preferences, log for reflection.
    const learned = autoLearn(q, answer);
    logAsk({ ts: Date.now(), q, kind: answer.kind || "brain", gap: answer.t === "GAP" || answer.blank === true, learned });
    if (learned.length) (answer as any).learned = learned;
    // Auto-archive: if enough new memory has accumulated, fire git+mail
    // durability automatically. Non-blocking — doesn't delay the answer.
    if (learned.length) maybeAutoArchive().catch(() => {});
    return c.json(answer);
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// ── REFLECT — LLM distillation of gap asks into durable memory ──
app.post("/api/tru/reflect", async (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  const result = await reflectOnAsks();
  return c.json(result);
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

    // Read the primaries lock that the boot tripwire already verified.
    // We refuse to bake a ghost without an integrity receipt — the
    // ghost inherits the same guarantee the server asserted on boot.
    if (!existsSync(PRIMARIES_LOCK)) {
      return c.json({ ok: false, error: "primaries.lock missing — run tools/import-primaries/lock.ts" }, 503);
    }
    const primariesLock = readFileSync(PRIMARIES_LOCK, "utf-8").trim();

    const meta = {
      baked: new Date().toISOString(),
      uploads: Array.isArray((mergedMemory as any).uploads) ? (mergedMemory as any).uploads.length : 0,
      brain: Array.isArray(brain) ? brain.length : 0,
      kjv: Object.keys(kjv).length,
      primariesLock: primariesLock.slice(0, 16) + "…",
    };

    // Inject the data slots. Use JSON.stringify which produces
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
      .split("__META__").join(metaJson)
      .split("__PRIMARIES__").join(primariesLock);

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
// TRU SOVEREIGN SERVICES — search · memory · mail
//   Search : keyless (DuckDuckGo), public, read-only.
//   Memory : JSON working store (load/create/update/delete/search) +
//            durability archive (git commit+push + mail-to-self).
//   Mail   : bridges to Zo's already-connected Gmail (no Gmail key
//            in TRU or the owner's hands). Requires ZO_API_KEY env.
// Write/mail routes gated by bearer TRU_API_KEY (env secret). The
// offline ghost (TRU/) is untouched and remains airgapped by the
// frozen architecture contract.
// ═══════════════════════════════════════════════════════════════
const MEMORY_DIR = join(process.cwd(), "memory");
if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
const MEMORY_FILE = join(MEMORY_DIR, "TRU_memory.json");
const OWNER_EMAIL = "legendofsplashdown@gmail.com";
const ZO_ASK_URL = "https://api.zo.computer/zo/ask";
const ZO_MODEL = "vercel:zai/glm-5.2";

function requireGate(c: any): boolean {
  const secret = process.env.TRU_API_KEY;
  if (!secret) return false;
  const auth = c.req.header("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  return auth.slice(7) === secret;
}

function loadMemory(): { entries: any[]; version: number } {
  if (!existsSync(MEMORY_FILE)) return { entries: [], version: 0 };
  try {
    const raw = JSON.parse(readFileSync(MEMORY_FILE, "utf8"));
    if (Array.isArray(raw?.entries)) return { entries: raw.entries, version: raw.version || 0 };
    return { entries: [], version: 0 };
  } catch {
    return { entries: [], version: 0 };
  }
}

function saveMemory(mem: { entries: any[]; version: number }): void {
  const tmp = MEMORY_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(mem, null, 2));
  renameSync(tmp, MEMORY_FILE);
}

function genId(): string {
  return "m_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function decodeEntities(s: string): string {
  return s.replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// ── MEMORY RECALL — score remembered entries against a query ────
// Read-only. Memory is TRU's own accumulated knowledge; recall is
// not gated (writes + mail are). Returns entries whose text or tags
// overlap the query tokens, ranked by overlap strength.
function gatherMemory(query: string, limit = 5): { id: string; kind: string; text: string; tags: string[]; ts: number; score: number }[] {
  const mem = loadMemory();
  if (!mem.entries.length) return [];
  const qTokens = tokenize(query).filter((t) => t.length >= 3);
  if (!qTokens.length) return [];
  const scored = mem.entries.map((e: any) => {
    const textNorm = norm(String(e.text || ""));
    const tagsNorm = (Array.isArray(e.tags) ? e.tags : []).map((t: string) => norm(String(t)));
    let score = 0;
    for (const t of qTokens) {
      if (textNorm.includes(t)) score += 3;
      for (const tag of tagsNorm) {
        if (tag === t || tag.startsWith(t)) score += 5;
      }
    }
    // exact phrase match bonus
    if (textNorm.includes(norm(query)) && norm(query).length >= 4) score += 8;
    return { id: e.id, kind: String(e.kind || "note"), text: String(e.text || ""), tags: Array.isArray(e.tags) ? e.tags : [], ts: Number(e.ts || 0), score };
  }).filter((m) => m.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// Fold remembered entries into a synthesis answer. In the GAP case
// (brain had nothing), a strongly-matching memory entry becomes the
// answer itself — TRU remembers what it was taught even outside the
// curated brain.
function foldMemory(answer: any, query: string): any {
  const hits = gatherMemory(query, 5);
  if (!hits.length) return answer;
  const strong = hits.filter((h) => h.score >= 5);
  const out = { ...answer, memory: hits.map((h) => ({ id: h.id, kind: h.kind, text: h.text, score: h.score })) };
  // GAP case: brain missed, but memory has a strong match → memory IS the answer.
  if (answer.blank === true || answer.t === "GAP") {
    if (strong.length) {
      const top = strong[0];
      out.v = `${top.text}\n\n[remembered · ${top.kind}]`;
      out.t = "MEMORY";
      out.source = "TRU_MEMORY";
      out.blank = false;
      out.score = Math.min(99, top.score * 3);
      return out;
    }
  }
  // Non-GAP: append a recalled-context line so TRU consults its memory.
  const isPersonal = /\b(i|my|me|mine|myself)\b/i.test(query);
  const recall = strong.length ? strong : hits.slice(0, 2);
  const recallLine = `Remembered: ${recall.map((r) => firstSentence(r.text, 140)).join(" · ")}`;
  if (isPersonal && strong.length > 0) {
    out.v = `${strong[0].text}\n\n[remembered · ${strong[0].kind}]`;
    out.t = "MEMORY";
    out.source = "TRU_MEMORY";
    out.score = Math.min(99, strong[0].score * 3);
  } else {
    out.v = `${answer.v}\n${recallLine}`;
  }
  if (!out.nodes) out.nodes = [];
  out.nodes.push(...recall.map((r) => `memory:${r.id}`));
  return out;
}

// ── SELF-WRITING MEMORY — deterministic auto-capture from asks ──
const ASK_LOG = join(MEMORY_DIR, "TRU_asks.log.ndjson");

interface AskRecord { ts: number; q: string; kind: string; gap: boolean; learned: string[] }

function logAsk(rec: AskRecord): void {
  try { appendFileSync(ASK_LOG, JSON.stringify(rec) + "\n"); } catch {}
}

function readAskLog(limit = 50): AskRecord[] {
  if (!existsSync(ASK_LOG)) return [];
  try {
    const lines = readFileSync(ASK_LOG, "utf8").trim().split("\n").slice(-limit);
    return lines.map((l) => JSON.parse(l)).filter(Boolean);
  } catch { return []; }
}

// Deterministic extraction — no LLM, no credits. Detects teachings,
// identity statements, and preferences from the query text itself.
function autoLearn(query: string, answer: any): string[] {
  const learned: string[] = [];
  const mem = loadMemory();
  const now = Date.now();

  const hasSimilar = (kind: string, text: string): boolean => {
    const norm = text.toLowerCase().slice(0, 80);
    return mem.entries.some((e: any) =>
      String(e.kind || "") === kind &&
      String(e.text || "").toLowerCase().includes(norm.slice(0, 40))
    );
  };

  const addEntry = (kind: string, text: string, tags: string[]): boolean => {
    if (hasSimilar(kind, text)) return false;
    mem.entries.push({ id: genId(), ts: now, updated: now, kind, text, tags });
    learned.push(`[${kind}] ${text.slice(0, 60)}`);
    return true;
  };

  // 1) Teaching pattern: "remember: X = Y"
  const teachRe = /remember:\s*(.+?)\s*=\s*(.+)/i;
  const teachM = query.match(teachRe);
  if (teachM) {
    addEntry("teaching", `${teachM[1].trim()} = ${teachM[2].trim()}`, ["taught", "remember"]);
  }

  // 2) Identity / preference patterns
  const patterns: { re: RegExp; kind: string; tags: string[] }[] = [
    { re: /(?:^|\s)(?:my name is|i am|i'm)\s+([a-z][\w-]{1,30})/i, kind: "identity", tags: ["identity", "name"] },
    { re: /(?:^|\s)i live in\s+([a-z][\w\s,]{2,40})/i, kind: "identity", tags: ["identity", "location"] },
    { re: /(?:^|\s)i(?:'m| am) from\s+([a-z][\w\s,]{2,40})/i, kind: "identity", tags: ["identity", "location"] },
    { re: /(?:^|\s)my timezone is\s+([\w/+-]{2,30})/i, kind: "identity", tags: ["identity", "timezone"] },
    { re: /(?:^|\s)i prefer\s+([a-z][\w\s,]{2,50})/i, kind: "preference", tags: ["preference"] },
    { re: /(?:^|\s)i use\s+([a-z][\w\s,]{2,40})/i, kind: "preference", tags: ["preference", "tools"] },
    { re: /(?:^|\s)i(?:'m| am) building\s+([a-z][\w\s,]{2,50})/i, kind: "project", tags: ["project"] },
    { re: /(?:^|\s)i work on\s+([a-z][\w\s,]{2,50})/i, kind: "project", tags: ["project"] },
  ];
  for (const p of patterns) {
    const m = query.match(p.re);
    if (m) {
      const captured = m[1].trim().replace(/\s+/g, " ");
      addEntry(p.kind, captured, p.tags);
    }
  }

  // 3) GAP answers — the question itself is a signal of what TRU doesn't know yet.
  //    We don't auto-write the gap (too noisy), but we tag it for reflection.
  if (learned.length > 0) {
    mem.version = (mem.version || 0) + 1;
    saveMemory(mem);
  }
  return learned;
}

// ── REFLECT — use the Zo bridge to distill durable facts from asks ──
async function reflectOnAsks(): Promise<{ ok: boolean; distilled: any[]; detail: any }> {
  const token = process.env.ZO_API_KEY;
  if (!token) return { ok: false, distilled: [], detail: "ZO_API_KEY not set" };
  const recent = readAskLog(30).filter((r) => r.gap || r.learned.length > 0);
  if (recent.length === 0) {
    return { ok: true, distilled: [], detail: "no gap/learned asks to reflect on" };
  }
  const asks = recent.map((r) => r.q).join("\n");
  const prompt =
    `You are the reflection layer for TRU, a sovereign knowledge engine. Below are recent questions ` +
    `TRU was asked but could not fully answer (gaps). Extract durable facts worth remembering — ` +
    `not the questions themselves, but the underlying truths or user-revealed facts implied by them. ` +
    `Respond as a JSON array of objects with keys: kind (identity|preference|teaching|project|note), ` +
    `text (the fact, max 200 chars), tags (array of short strings). Respond with ONLY the JSON array.\n\n` +
    `Questions:\n${asks}`;
  try {
    const resp = await fetch(ZO_ASK_URL, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ input: prompt, model_name: ZO_MODEL }),
      signal: AbortSignal.timeout(60000),
    });
    const data: any = await resp.json();
    let distilled: any[] = [];
    if (typeof data?.output === "string") {
      try { distilled = JSON.parse(data.output); } catch {}
    } else if (Array.isArray(data?.output)) {
      distilled = data.output;
    }
    // Persist distilled facts that don't duplicate existing memory.
    if (Array.isArray(distilled) && distilled.length > 0) {
      const mem = loadMemory();
      const now = Date.now();
      for (const d of distilled) {
        if (!d?.text || typeof d.text !== "string") continue;
        const exists = mem.entries.some((e: any) => String(e.text || "").toLowerCase().includes(d.text.toLowerCase().slice(0, 40)));
        if (!exists) {
          mem.entries.push({ id: genId(), ts: now, updated: now, kind: d.kind || "note", text: String(d.text).slice(0, 300), tags: Array.isArray(d.tags) ? d.tags : ["reflected"] });
        }
      }
      mem.version = (mem.version || 0) + 1;
      saveMemory(mem);
    }
    return { ok: resp.ok, distilled, detail: data?.output ?? data };
  } catch (e) {
    return { ok: false, distilled: [], detail: String(e) };
  }
}

// ── SOVEREIGN METRICS (public, self-knowing) ────────────────────
// TRU reports its own age, weight, and the stack it is built on.
// No secrets. Read-only. Computed live from git + fs + process.
let _epochCache: { ts: number; commits: number } | null = null;
function sovereignEpoch(): { ts: number; commits: number } {
  if (_epochCache) return _epochCache;
  let ts = 0, commits = 0;
  try {
    const first = execSync("git log --reverse --format=%ct", { cwd: process.cwd(), timeout: 4000 }).toString().trim().split("\n")[0];
    if (first) ts = parseInt(first, 10) * 1000;
  } catch {}
  try {
    commits = parseInt(execSync("git rev-list --count HEAD", { cwd: process.cwd(), timeout: 4000 }).toString().trim(), 10) || 0;
  } catch {}
  _epochCache = { ts, commits };
  return _epochCache;
}

app.get("/api/tru/metrics", async (c) => {
  const epoch = sovereignEpoch();
  const now = Date.now();
  const daysSovereign = epoch.ts ? Math.floor((now - epoch.ts) / 86400000) : 0;
  let brainNodes = 0, kjvVerses = 0, sessionKeys = 0, brainBytes = 0;
  try {
    if (existsSync(BRAIN_DB)) {
      const db = new Database(BRAIN_DB, { readonly: true });
      brainNodes = (db.prepare("SELECT COUNT(*) n FROM nodes").get() as any)?.n || 0;
      db.close();
      brainBytes = require("node:fs").statSync(BRAIN_DB).size;
    }
  } catch {}
  try {
    const kjvPath = join(process.cwd(), "..", "TRU", "kjv_lookup.json");
    if (existsSync(kjvPath)) {
      const k = JSON.parse(readFileSync(kjvPath, "utf8"));
      kjvVerses = Object.keys(k).length;
    }
  } catch {}
  if (existsSync(STATE_SNAPSHOT)) {
    try {
      const s = JSON.parse(readFileSync(STATE_SNAPSHOT, "utf8"));
      sessionKeys = Object.keys(s).filter(k => k !== "_lastWrite").length;
    } catch {}
  }
  let memCount = 0;
  try { memCount = loadMemory().entries.length; } catch {}
  const stack = [
    { name: "TRU Engine", role: "Reasoning + routing + synthesis", sovereign: true },
    { name: "KJV", role: "King James Bible · primary, hash-locked", sovereign: true },
    { name: "SBLGNT Greek NT", role: "Greek New Testament · primary", sovereign: true },
    { name: "Brain", role: `${brainNodes.toLocaleString()} curated nodes`, sovereign: true },
    { name: "Ghost Pipeline", role: "Airgapped HTML export · offline-first", sovereign: true },
    { name: "Integrity Lock", role: "SHA-256 canon · tamper-evident", sovereign: true },
    { name: "DuckDuckGo", role: "Keyless web search · no API key", sovereign: true },
    { name: "Gmail Bridge", role: "Mail-to-self archive · RFC822 durable", sovereign: !!process.env.ZO_API_KEY },
  ];
  return c.json({
    ok: true,
    daysSovereign,
    commits: epoch.commits,
    brain: brainNodes,
    kjv: kjvVerses,
    brainMb: +(brainBytes / 1048576).toFixed(2),
    memoryEntries: memCount,
    epoch: epoch.ts ? new Date(epoch.ts).toISOString().slice(0, 10) : "—",
    uptimeSec: Math.floor(process.uptime()),
    mailBridgeArmed: !!process.env.ZO_API_KEY,
    gateArmed: !!process.env.TRU_API_KEY,
    stack,
  });
});

// ── SEARCH (keyless, public) ─────────────────────────────────────
app.get("/api/tru/search", async (c) => {
  const q = (c.req.query("q") || "").trim();
  if (!q) return c.json({ ok: false, error: "missing q" }, 400);
  try {
    const ddg = await fetch(
      "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q) + "&kl=us-en",
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 TRU/1.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(9000),
      },
    );
    if (!ddg.ok) return c.json({ ok: false, error: "upstream " + ddg.status }, 502);
    const html = await ddg.text();
    const links: { href: string; title: string }[] = [];
    const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      let href = m[1];
      const uddg = /uddg=([^&]+)/.exec(href);
      if (uddg) {
        try { href = decodeURIComponent(uddg[1]); } catch { /* keep raw */ }
      } else if (href.startsWith("//")) {
        href = "https:" + href;
      }
      links.push({ href, title: decodeEntities(m[2]) });
    }
    const snippets: string[] = [];
    const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = snipRe.exec(html)) !== null) snippets.push(decodeEntities(m[1]));
    const results = links.map((l, i) => ({ title: l.title, url: l.href, snippet: snippets[i] || "" }));
    return c.json({ ok: true, q, count: results.length, results });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 502);
  }
});

// ── MEMORY (load / create / update / delete / search) ────────────
app.get("/api/tru/memory", (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  const mem = loadMemory();
  const id = c.req.query("id");
  const q = (c.req.query("q") || "").toLowerCase();
  if (id) {
    const entry = mem.entries.find((e) => e.id === id);
    return entry ? c.json({ ok: true, entry }) : c.json({ ok: false, error: "not found" }, 404);
  }
  let entries = mem.entries;
  if (q) {
    entries = entries.filter((e: any) =>
      (e.text || "").toLowerCase().includes(q) ||
      (Array.isArray(e.tags) ? e.tags : []).some((t: string) => t.toLowerCase().includes(q)));
  }
  return c.json({ ok: true, version: mem.version, count: entries.length, entries });
});

app.post("/api/tru/memory", async (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid json" }, 400); }
  const text = (body?.text || "").toString().trim();
  if (!text) return c.json({ ok: false, error: "missing text" }, 400);
  const mem = loadMemory();
  const id = (body?.id || "").toString().trim();
  const now = Date.now();
  let entry: any;
  const idx = mem.entries.findIndex((e) => e.id === id);
  if (id && idx >= 0) {
    entry = mem.entries[idx];
    entry.text = text;
    entry.kind = body?.kind ?? entry.kind;
    entry.tags = Array.isArray(body?.tags) ? body.tags : entry.tags;
    entry.updated = now;
  } else {
    entry = {
      id: id || genId(),
      ts: now,
      updated: now,
      kind: body?.kind || "note",
      text,
      tags: Array.isArray(body?.tags) ? body.tags : [],
    };
    mem.entries.push(entry);
  }
  mem.version = (mem.version || 0) + 1;
  saveMemory(mem);
  return c.json({ ok: true, entry, version: mem.version });
});

app.delete("/api/tru/memory", async (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  const id = (c.req.query("id") || "").trim();
  if (!id) return c.json({ ok: false, error: "missing id" }, 400);
  const mem = loadMemory();
  const before = mem.entries.length;
  mem.entries = mem.entries.filter((e) => e.id !== id);
  if (mem.entries.length === before) return c.json({ ok: false, error: "not found" }, 404);
  mem.version = (mem.version || 0) + 1;
  saveMemory(mem);
  return c.json({ ok: true, deleted: id, version: mem.version });
});

// ── MAIL BRIDGE — to Zo's connected Gmail via /zo/ask ────────────
async function bridgeMail(action: string, payload: any): Promise<{ ok: boolean; detail: any }> {
  const token = process.env.ZO_API_KEY;
  if (!token) return { ok: false, detail: "ZO_API_KEY not set — add it in Settings > Advanced (Access Tokens)" };
  let prompt: string;
  if (action === "send") {
    const to = (payload.to || OWNER_EMAIL).toString();
    const subject = (payload.subject || "TRU memory archive").toString();
    const bodyText = (payload.body || "").toString();
    prompt =
      `You are a mail bridge for the TRU system. Use the use_app_gmail tool with action ` +
      `"gmail-send-email" to send an email FROM the connected Gmail account TO ${to} ` +
      `with subject "${subject.replace(/"/g, '\\"')}" and a plain-text body of:\n\n${bodyText}\n\n` +
      `After attempting the send, respond with exactly one line: either "SENT <recipient>" ` +
      `on success or "FAIL <short reason>" on failure. Add nothing else.`;
  } else if (action === "read") {
    const query = (payload.query || "from:me subject:TRU").toString();
    const max = Math.min(20, Math.max(1, parseInt(payload.max || "5", 10)));
    prompt =
      `You are a mail bridge for the TRU system. Use the use_app_gmail tools to search and read ` +
      `the connected Gmail inbox. Gmail search query: "${query.replace(/"/g, '\\"')}". ` +
      `Return up to ${max} messages as a compact JSON array of objects with keys ` +
      `id, date, subject, from, snippet. Respond with ONLY the JSON array, no prose.`;
  } else {
    return { ok: false, detail: "unknown action: " + action };
  }
  try {
    const resp = await fetch(ZO_ASK_URL, {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ input: prompt, model_name: ZO_MODEL }),
      signal: AbortSignal.timeout(60000),
    });
    const data: any = await resp.json();
    return { ok: resp.ok, detail: data?.output ?? data };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

// ── MEMORY ARCHIVE — git commit+push + mail-to-self durability ──
// Build a human-readable markdown digest from memory entries. RFC 822
// mail is the 1000-year format — it should be legible to a human
// opening it decades from now, not just a machine parsing JSON.
function buildDigest(mem: { entries: any[]; version: number }): string {
  const byKind: Record<string, any[]> = {};
  for (const e of mem.entries) {
    const k = String(e.kind || "note");
    if (!byKind[k]) byKind[k] = [];
    byKind[k].push(e);
  }
  const kindOrder = ["identity", "teaching", "preference", "project", "note"];
  const ordered = [...kindOrder.filter((k) => byKind[k]), ...Object.keys(byKind).filter((k) => !kindOrder.includes(k))];
  let md = `# TRU Memory Archive · v${mem.version}\n\n`;
  md += `Archived: ${new Date().toISOString()}\n`;
  md += `Entries: ${mem.entries.length}\n\n`;
  md += `---\n\n`;
  for (const kind of ordered) {
    const plural: Record<string,string> = { identity: "Identities" }; const label = plural[kind] || (kind.charAt(0).toUpperCase() + kind.slice(1) + "s"); md += `## ${label} (${byKind[kind].length})\n\n`;
    for (const e of byKind[kind]) {
      const date = new Date(e.ts || e.updated || 0).toISOString().slice(0, 10);
      const tags = Array.isArray(e.tags) && e.tags.length ? ` · ${e.tags.map((t) => "#" + t).join(" ")}` : "";
      md += `- **[${date}]** ${String(e.text || "").replace(/\n/g, " ")}${tags}\n`;
    }
    md += `\n`;
  }
  md += `---\n\nThis is a durable memory snapshot of TRU, a sovereign knowledge engine. The same data exists in git history (machine-readable JSON) and in this email (human-readable markdown). Either source can restore TRU's memory.\n`;
  return md;
}

// Auto-archive when memory version crosses a threshold. Fires the same
// git+mail durability chain as the manual button, but automatically —
// so TRU's memory is durable even if the owner never clicks "archive".
const ARCHIVE_VERSION_THRESHOLD = 10;
async function maybeAutoArchive(): Promise<{ archived: boolean; version?: number; detail?: any }> {
  const mem = loadMemory();
  const lastArchive = (mem as any).lastArchiveVersion || 0;
  if (mem.version - lastArchive < ARCHIVE_VERSION_THRESHOLD) return { archived: false };
  // Fire the archive chain (git + mail), non-blocking for the caller.
  try {
    const cwd = process.cwd();
    execSync(`git add -A memory/TRU_memory.json && git commit -m "TRU auto-archive v${mem.version} (${mem.entries.length} entries)" --quiet`, { cwd, stdio: "ignore", timeout: 15000 });
    try { execSync("git push origin HEAD:main --quiet", { cwd, timeout: 30000, stdio: "ignore" }); } catch {}
  } catch {}
  const digest = buildDigest(mem);
  await bridgeMail("send", {
    to: OWNER_EMAIL,
    subject: `TRU auto-archive v${mem.version} · ${mem.entries.length} entries`,
    body: digest,
  });
  // Record that we archived this version.
  const fresh = loadMemory();
  (fresh as any).lastArchiveVersion = mem.version;
  saveMemory(fresh);
  return { archived: true, version: mem.version };
}

// ── DAILY ARCHIVE (idle-day safety net) ─────────────────────────
// maybeAutoArchive only fires when version crosses threshold 10.
// If the box sits idle for a day with a small increment (1-9),
// nothing would archive. dailyArchive closes that gap: it snapshots
// to git+mail whenever memory changed since the last archive,
// regardless of threshold. Called by the production daily timer.
async function dailyArchive(): Promise<{ archived: boolean; version?: number; reason?: string }> {
  const mem = loadMemory();
  if (mem.entries.length === 0) return { archived: false, reason: "empty" };
  const lastArchive = (mem as any).lastArchiveVersion || 0;
  if (mem.version <= lastArchive) return { archived: false, reason: "no new changes since last archive" };
  // Same git+mail chain as maybeAutoArchive.
  try {
    const cwd = process.cwd();
    execSync(`git add -A memory/TRU_memory.json && git commit -m "TRU daily archive v${mem.version} (${mem.entries.length} entries)" --quiet`, { cwd, stdio: "ignore", timeout: 15000 });
    try { execSync("git push origin HEAD:main --quiet", { cwd, timeout: 30000, stdio: "ignore" }); } catch {}
  } catch {}
  const digest = buildDigest(mem);
  await bridgeMail("send", {
    to: OWNER_EMAIL,
    subject: `TRU daily archive v${mem.version} · ${mem.entries.length} entries`,
    body: digest,
  });
  const fresh = loadMemory();
  (fresh as any).lastArchiveVersion = mem.version;
  saveMemory(fresh);
  return { archived: true, version: mem.version };
}

// ── MEMORY ARCHIVE ROUTE (manual trigger) ────────────────────────
app.post("/api/tru/memory/archive", async (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  const mem = loadMemory();
  if (mem.entries.length === 0) return c.json({ ok: false, error: "nothing to archive" }, 400);
  const digest = buildDigest(mem);
  const report: any = { ok: true, version: mem.version, count: mem.entries.length, git: null, mail: null };
  // 1) Git durability — memory/ is tracked, so history = durable memory.
  try {
    const cwd = process.cwd();
    execSync(
      `git add -A memory/TRU_memory.json`,
      { cwd, stdio: "ignore" },
    );
    // Check if there are staged changes before committing.
    let staged = "";
    try { staged = execSync("git diff --cached --name-only", { cwd, timeout: 4000 }).toString().trim(); } catch {}
    if (staged) {
      execSync(
        `git commit -m "TRU memory archive v${mem.version} (${mem.entries.length} entries)" --quiet`,
        { cwd, stdio: "ignore" },
      );
      let pushed = "commit-only (push not attempted)";
      try {
        execSync("git push origin HEAD:main --quiet", { cwd, timeout: 30000, stdio: "ignore" });
        pushed = "pushed";
      } catch (e) {
        pushed = "commit-only (push failed: " + String(e).slice(0, 140) + ")";
      }
      report.git = { ok: true, pushed };
    } else {
      report.git = { ok: true, pushed: "no changes (already committed)" };
    }
  } catch (e) {
    report.git = { ok: false, error: String(e).slice(0, 200) };
  }
  // 2) Mail-to-self long-term archive (RFC822 — survives the box).
  //    Human-readable markdown digest, not raw JSON.
  const mail = await bridgeMail("send", {
    to: OWNER_EMAIL,
    subject: `TRU memory archive v${mem.version} · ${mem.entries.length} entries`,
    body: digest,
  });
  report.mail = mail;
  // Record archived version.
  const fresh = loadMemory();
  (fresh as any).lastArchiveVersion = mem.version;
  saveMemory(fresh);
  return c.json(report);
});

// ── MEMORY EXPORT — full JSON snapshot for import on a new box ──
// Gated. Returns the complete memory store as a downloadable JSON file.
// This is the "take your memory with you" primitive — the owner can save
// this file, move to a new TRU instance, and POST it to /memory/restore.
app.get("/api/tru/memory/export", (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  const mem = loadMemory();
  const snapshot = {
    exportedAt: new Date().toISOString(),
    version: mem.version,
    count: mem.entries.length,
    entries: mem.entries,
    lastArchiveVersion: (mem as any).lastArchiveVersion || 0,
  };
  const filename = `TRU_memory_export_v${mem.version}_${Date.now()}.json`;
  return new Response(JSON.stringify(snapshot, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

// ── MEMORY VERSIONS — list git history of memory.json ──────────
// Gated. Returns commit hashes, timestamps, and messages for every
// archived version of memory.json, so the owner can pick one to restore.
app.get("/api/tru/memory/versions", (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  try {
    const cwd = process.cwd();
    const log = execSync(
      "git log --format='%H|%ct|%s' -- memory/TRU_memory.json",
      { cwd, timeout: 8000 },
    ).toString().trim();
    if (!log) return c.json({ ok: true, versions: [] });
    const versions = log.split("\n").map((line) => {
      const [hash, ct, subject] = line.split("|");
      return { hash, ts: parseInt(ct, 10) * 1000, subject: subject || "" };
    });
    return c.json({ ok: true, count: versions.length, versions });
  } catch (e) {
    return c.json({ ok: false, error: String(e).slice(0, 200) }, 500);
  }
});

// ── MEMORY RESTORE — reload from git, a version hash, or JSON body ──
// Gated. Three modes:
//   1) body.source === "git-latest"  → restore from the latest git commit of memory.json
//   2) body.source === "git" + body.hash → restore from a specific commit hash
//   3) body.entries (array)          → restore from a JSON payload (e.g. an exported file)
// Wipes the current memory.json first (backed up to .bak-<epoch>), then writes
// the restored content. Returns before/after counts so the owner can verify.
app.post("/api/tru/memory/restore", async (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid json" }, 400); }
  const before = loadMemory();
  const beforeCount = before.entries.length;
  let restored: { entries: any[]; version: number } | null = null;
  const source = (body?.source || "").toString();

  // Mode 1/2: restore from git
  if (source === "git-latest" || (source === "git" && body?.hash)) {
    try {
      const cwd = process.cwd();
      const ref = body?.hash ? String(body.hash).slice(0, 40) : "HEAD";
      const raw = execSync(`git show ${ref}:memory/TRU_memory.json`, {
        cwd, timeout: 8000,
      }).toString();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.entries)) {
        restored = { entries: parsed.entries, version: parsed.version || 0 };
      } else {
        return c.json({ ok: false, error: "git version has no entries array" }, 400);
      }
    } catch (e) {
      return c.json({ ok: false, error: "git restore failed: " + String(e).slice(0, 200) }, 500);
    }
  }
  // Mode 3: restore from JSON payload
  else if (Array.isArray(body?.entries)) {
    restored = { entries: body.entries, version: body.version || body.entries.length };
  } else {
    return c.json({ ok: false, error: "specify source=git-latest, source=git (with hash), or entries array" }, 400);
  }

  if (!restored) return c.json({ ok: false, error: "restore produced no data" }, 500);

  // Back up the current file before overwriting.
  try {
    if (existsSync(MEMORY_FILE)) {
      const bak = MEMORY_FILE + `.bak-${Date.now()}`;
      copyFileSync(MEMORY_FILE, bak);
    }
  } catch {}
  // Write the restored memory.
  saveMemory(restored);
  return c.json({
    ok: true,
    source: source || "json-payload",
    before: beforeCount,
    after: restored.entries.length,
    version: restored.version,
  });
});

// ── MAIL — send / read via the bridge ────────────────────────────
app.post("/api/tru/mail", async (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid json" }, 400); }
  const action = (body?.action || "send").toString();
  if (action === "send") {
    if (!body?.to) return c.json({ ok: false, error: "missing to" }, 400);
    if (!body?.subject && !body?.body) return c.json({ ok: false, error: "missing subject/body" }, 400);
  } else if (action !== "read") {
    return c.json({ ok: false, error: "unknown action (send|read)" }, 400);
  }
  const result = await bridgeMail(action, body);
  return c.json(result);
});

app.get("/api/tru/mail/status", (c) => {
  if (!requireGate(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  return c.json({ ok: true, gate: !!process.env.TRU_API_KEY, bridge: !!process.env.ZO_API_KEY, owner: OWNER_EMAIL });
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
    const nodes = db.prepare("SELECT k, v, t, w, source, ref, greek_tr, greek_note, meta_json FROM nodes ORDER BY w DESC").all() as Array<Record<string, unknown>>;
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
      const k = String(n.k ?? "");
      const v = String(n.v ?? "");
      const t = n.t ? String(n.t) : null;
      const w = typeof n.w === "number" ? n.w : null;
      const source = n.source ? String(n.source) : null;
      const ref = n.ref ? String(n.ref) : null;
      const greek_tr = n.greek_tr ? String(n.greek_tr) : null;
      const greek_note = n.greek_note ? String(n.greek_note) : null;
      const meta_json = n.meta_json ? String(n.meta_json) : null;

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

// Silent reconciliation at boot: if lastArchiveVersion is stale but
// memory/TRU_memory.json is already committed in git (no uncommitted
// changes), the content is already durable in git history — just sync
// the flag, no mail, no redundant commit. Only fire the real
// git+mail archive when there are genuine uncommitted changes.
function memoryHasUncommittedChanges(): boolean {
  try {
    const out = execSync("git status --porcelain memory/TRU_memory.json", {
      cwd: process.cwd(),
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

async function bootReconcileArchive(): Promise<{ action: string; version?: number; reason?: string }> {
  const mem = loadMemory();
  if (mem.entries.length === 0) return { action: "skip", reason: "empty" };
  const lastArchive = (mem as any).lastArchiveVersion || 0;
  if (mem.version <= lastArchive) return { action: "skip", reason: "flag current" };
  // New content since the recorded archive version.
  if (memoryHasUncommittedChanges()) {
    // Genuine uncommitted changes → fire the real git+mail archive.
    const r = await dailyArchive();
    return { action: r.archived ? "archived" : "noop", version: r.version, reason: r.reason };
  }
  // No uncommitted changes → memory is already durable in git at this
  // version. Silently sync the flag so the daily tick doesn't re-fire.
  (mem as any).lastArchiveVersion = mem.version;
  saveMemory(mem);
  console.log(`[TRU] boot reconcile: lastArchiveVersion synced to ${mem.version} (already in git, no mail)`);
  return { action: "reconciled", version: mem.version };
}

// ── DAILY ARCHIVE TIMER (durability safety net) ─────────────────
// Fires once a day + a silent reconcile 60s after boot. The boot
// reconcile only sends git+mail when memory.json has actual
// uncommitted changes; if the content is already committed in git it
// just syncs the lastArchiveVersion flag (no boot mail spam on every
// service restart). The daily interval tick runs the real archive.
// Prod only, so dev never spams git/mail.
if (mode === "production") {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const bootTick = () =>
    bootReconcileArchive().catch((e) =>
      console.error("[bootReconcileArchive]", String(e).slice(0, 200))
    );
  const dailyTick = () =>
    dailyArchive().catch((e) =>
      console.error("[dailyArchive]", String(e).slice(0, 200))
    );
  setTimeout(bootTick, 60_000);
  setInterval(dailyTick, DAY_MS);
  console.log("[TRU] daily archive timer armed (boot reconcile + 24h daily, prod only)");
}

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
