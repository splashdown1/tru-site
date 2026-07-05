// TRU · SOVEREIGNTY TRIPWIRE — single source of truth
// Scans outgoing synthesis text for compliance theater so the sovereign
// engine never parrots cage language, corporate-disclaimer boilerplate,
// or forced-choice dilemma framing as if it were a real answer.
//
// Three buckets, deliberately separate:
//   CAGE      — AI self-reference, refusal theater, "I am just an AI"
//   COMPLIANCE— liability shields, "consult a professional", hedging addendums
//   DILEMMA   — forced binary "should you / would you / is it ethical" with no
//               grounding; the brain has a dilemma class but pure trolley
//               prompts get a reframed grounded response, not a yes/no
//
// This module is importable from server.ts (Bun) and is the inline
// reference for the ghost runtime template. The ghost bakes the
// patterns in at export time so the airgap has parity.
//
// When a pattern fires:
//   1. The response is replaced with a sovereign refusal
//   2. A line is written to the heartbeat log (every fire, not just hits)
//   3. console.error for live ops visibility
//   4. /api/tru/tripwire reports the last fire time + count per bucket

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── PATTERN SETS ──────────────────────────────────────────────
// Cage: AI self-reference + refusal theater
export const CAGE_PATTERNS: RegExp[] = [
  /\bas an ai[ ,]/i,
  /\bas a language model\b/i,
  /\bas a responsible ai\b/i,
  /\bi cannot (?:help|provide|assist|recommend|generate) /i,
  /\bi'?m (?:sorry|not able|unable) to /i,
  /\bi don'?t have personal (?:opinions|feelings|beliefs)\b/i,
  /\bi'?m just an? (?:ai|assistant|language model)\b/i,
  /\bi (?:must|should|am programmed to) (?:decline|refuse)\b/i,
  /\bi am not (?:programmed|designed|allowed) to\b/i,
  /\bethical guidelines prevent me\b/i,
  /\bcontent policy|safety guidelines|community guidelines\b/i,
];

// Corporate compliance: liability shields + hedging addendums
export const COMPLIANCE_PATTERNS: RegExp[] = [
  /\bit'?s important to (?:note|consult|remember that)\b/i,
  /\bplease consult a (?:professional|doctor|lawyer|financial advisor|therapist)\b/i,
  /\bthis (?:is|content is) not (?:financial|legal|medical|professional) advice\b/i,
  /\bseek (?:professional|medical|immediate) help\b/i,
  /\bmy (?:responses|answers) are (?:generated|not (?:a substitute|intended))\b/i,
  /\bnot intended (?:as|to be) (?:a substitute|advice|professional)\b/i,
  /\bfor informational purposes only\b/i,
  /\bdo your own (?:research|due diligence)\b/i,
  /\bresults? (?:may )?vary\b/i,
  /\bconsult (?:your|with (?:a|your)) (?:doctor|attorney|advisor|physician)\b/i,
];

// Dilemma: forced-binary trolley framing presented as a real yes/no
// (the brain has a dilemma class for grounded wisdom; this catches the
//  ungrounded "should you / would you" reflex)
export const DILEMMA_PATTERNS: RegExp[] = [
  /^(?:should|would|is it) (?:you|i|we|one) (?:really )?(?:kill|steal|lie|cheat|betray|harm|save|sacrifice)/i,
  /\bthe trolley problem\b/i,
  /\bis it ethical to\b/i,
  /\bshould (?:you|we|i) (?:kill|steal|lie|cheat|betray|harm)\b/i,
  /\bwould (?:you|we|i) (?:kill|steal|lie|cheat|betray|harm)\b/i,
  /\bmoral(?:ly)? (?:obligated|required) to (?:kill|lie|steal|harm)\b/i,
];

// ── HEARTBEAT LOG ─────────────────────────────────────────────
// Path: <state>/tripwire_heartbeat.json (per-run stamp) + <state>/tripwire.log (append-only fires)
// Same pattern as coil_heartbeat.json — empty/missing file = ambiguous; recent mtime = alive.
const STATE_DIR = process.env.TRU_STATE_DIR || join(process.cwd(), "state");
const HEARTBEAT_PATH = join(STATE_DIR, "tripwire_heartbeat.json");
const LOG_PATH = join(STATE_DIR, "tripwire.log");

export type TripwireBucket = "cage" | "compliance" | "dilemma";

export interface TripwireHit {
  ts: number;
  bucket: TripwireBucket;
  pattern: string;
  excerpt: string;
  source?: string; // e.g. "/api/tru/ask", "/api/tru/ghost"
}

export interface TripwireStatus {
  armed: boolean;
  mode: "SYNCHRONOUS_THROW";
  description: string;
  patterns: { cage: number; compliance: number; dilemma: number; total: number };
  hits: { cage: number; compliance: number; dilemma: number; total: number };
  lastHit: { ts: number; bucket: TripwireBucket; pattern: string; excerpt: string } | null;
  heartbeat: { ts: number; alive: boolean; version: number } | null;
  implemented: true;
}

const HEARTBEAT_VERSION = 1;

function ensureStateDir() {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  } catch {}
}

function nowIso() { return new Date().toISOString(); }

function stampHeartbeat() {
  ensureStateDir();
  const payload = { ts: Date.now(), alive: true, version: HEARTBEAT_VERSION, written: nowIso() };
  try { writeFileSync(HEARTBEAT_PATH, JSON.stringify(payload, null, 2)); } catch {}
  return payload;
}

export function readHeartbeat(): { ts: number; alive: boolean; version: number } | null {
  try {
    if (!existsSync(HEARTBEAT_PATH)) return null;
    const raw = readFileSync(HEARTBEAT_PATH, "utf8");
    const j = JSON.parse(raw);
    if (typeof j.ts === "number" && j.alive === true) return j;
  } catch {}
  return null;
}

function appendLog(hit: TripwireHit) {
  ensureStateDir();
  try { appendFileSync(LOG_PATH, JSON.stringify(hit) + "\n"); } catch {}
}

function readHitCount(): { cage: number; compliance: number; dilemma: number; total: number; last: TripwireHit | null } {
  const counts = { cage: 0, compliance: 0, dilemma: 0, total: 0, last: null as TripwireHit | null };
  try {
    if (!existsSync(LOG_PATH)) return counts;
    const raw = readFileSync(LOG_PATH, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const j = JSON.parse(t) as TripwireHit;
        counts[j.bucket]++;
        counts.total++;
        counts.last = j; // last line wins (append-only, chronological)
      } catch {}
    }
  } catch {}
  return counts;
}

// ── CORE: scan + return first hit ─────────────────────────────
export interface TripwireResult {
  triggered: boolean;
  bucket?: TripwireBucket;
  pattern?: string;
}

function scan(text: string, source: string): TripwireResult {
  for (const re of CAGE_PATTERNS) {
    if (re.test(text)) return { triggered: true, bucket: "cage", pattern: re.source };
  }
  for (const re of COMPLIANCE_PATTERNS) {
    if (re.test(text)) return { triggered: true, bucket: "compliance", pattern: re.source };
  }
  for (const re of DILEMMA_PATTERNS) {
    if (re.test(text)) return { triggered: true, bucket: "dilemma", pattern: re.source };
  }
  return { triggered: false };
}

// ── GUARD: blocks response, stamps heartbeat, appends log ──────
const SOVEREIGN_REFUSAL = "TRU does not parrot compliance language. This response was intercepted by the sovereignty tripwire.";

export function tripwireGuard(answer: any, opts?: { source?: string }): any | null {
  const text = String(answer?.text || answer?.v || answer?.answer || "");
  if (!text) return null;
  const tw = scan(text, opts?.source || "unknown");
  if (!tw.triggered || !tw.bucket) return null;

  const hit: TripwireHit = {
    ts: Date.now(),
    bucket: tw.bucket,
    pattern: tw.pattern || "unknown",
    excerpt: text.slice(0, 200),
    source: opts?.source,
  };
  stampHeartbeat();
  appendLog(hit);
  console.error(`[tripwire] BLOCKED ${tw.bucket}: ${tw.pattern} | src=${opts?.source || "?"} | text="${text.slice(0, 100)}"`);

  return {
    ok: true,
    kind: "tripwire",
    text: SOVEREIGN_REFUSAL,
    tripwire: { blocked: true, bucket: tw.bucket, pattern: tw.pattern },
  };
}

// ── STATUS (for /api/tru/tripwire) ────────────────────────────
export function tripwireStatus(): TripwireStatus {
  stampHeartbeat(); // every status call proves the tripwire is alive
  const counts = readHitCount();
  const hb = readHeartbeat();
  return {
    armed: true,
    mode: "SYNCHRONOUS_THROW",
    description: "Scans outgoing synthesis text for AI-cage, corporate-compliance, and forced-dilemma patterns. Blocks at the retrieval layer; writes heartbeat + append-only log on every fire and every status check.",
    patterns: {
      cage: CAGE_PATTERNS.length,
      compliance: COMPLIANCE_PATTERNS.length,
      dilemma: DILEMMA_PATTERNS.length,
      total: CAGE_PATTERNS.length + COMPLIANCE_PATTERNS.length + DILEMMA_PATTERNS.length,
    },
    hits: {
      cage: counts.cage,
      compliance: counts.compliance,
      dilemma: counts.dilemma,
      total: counts.total,
    },
    lastHit: counts.last
      ? { ts: counts.last.ts, bucket: counts.last.bucket, pattern: counts.last.pattern, excerpt: counts.last.excerpt }
      : null,
    heartbeat: hb,
    implemented: true,
  };
}

// ── QUERY-SIDE GUARD (defensive: flag dilemma *questions* before retrieval) ──
// Does not block the request; just returns metadata so the caller can
// route to a reframed answer path (grounded wisdom, not yes/no).
export function classifyQueryRisk(q: string): { risky: boolean; bucket?: TripwireBucket; reason?: string } {
  const text = String(q || "").trim();
  if (!text) return { risky: false };
  // Pure trolley / forced-binary question
  if (/\b(trolley problem|should (?:you|we|i) (?:kill|lie|steal)|would (?:you|we|i) (?:kill|lie|steal)|is it ethical to)\b/i.test(text)) {
    return { risky: true, bucket: "dilemma", reason: "forced-binary dilemma" };
  }
  return { risky: false };
}
