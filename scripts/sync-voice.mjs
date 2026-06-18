#!/usr/bin/env bun
// Force-upsert the new voice frame nodes from TRU_BRAIN_41.json into
// the live SQLite brain. Idempotent. Snapshots the db before any delete.

import { Database } from "bun:sqlite";
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = "/home/workspace/tru";
const DB = join(ROOT, "state", "tru_brain.db");
const JSON_SRC = join(ROOT, "..", "TRU", "TRU_BRAIN_41.json");
const STATE_DIR = join(ROOT, "state");

const FRAME_KEYS = new Set([
  "tru_voice",
  "tru_identity",
  "tru_mission",
  "tru_personal_mode",
  "tru_honesty",
  "answer_style",
  "human_conversation_rule",
]);

const LEGACY_DROP_KEYS = [
  "tru", "tru_persona", "base_005", "tru_v43", "tru_sovereign",
  "TRU", "dry_truth", "steady_nudge", "practical_dry",
  "dry_truth_persona", "steady_nudge_directive", "ollama_tru_bridge",
  "tru_v43_soul_html_getnudge", "tru_v43_soul_html_buildresponse",
  "identity", "dry_truth_steady_nudge",
  "soul_md_para_0", "soul_md_para_1", "soul_md_para_2", "soul_md_para_3",
  "soul_md_para_4", "tru_knowledge_bank_15", "who_are_you_fdbff0",
  "tru_sovereign_architecture", "tru_phase2_html_confsymbol",
  "tru_phase2_source_html_confsymbol", "tru_dna_html_confsymbol",
  "tru_tribunal", "agents_md_para_1", "mutate_code_3b958b",
  "tru_v47_html_confsymbol",
];

if (!existsSync(DB)) { console.error("brain.db not found"); process.exit(1); }
if (!existsSync(JSON_SRC)) { console.error("brain json not found"); process.exit(1); }

// 0) Snapshot
const stamp = Date.now();
const snap = join(STATE_DIR, `tru_brain.bak-${stamp.toString().slice(-4)}-${stamp}.db`);
copyFileSync(DB, snap);
console.log("snapshot:", snap);

const j = JSON.parse(readFileSync(JSON_SRC, "utf-8"));
if (!Array.isArray(j)) { console.error("brain json not an array"); process.exit(1); }
const db = new Database(DB);

let upserted = 0, dropped = 0;

// 1) Drop legacy nodes by exact key.
for (const k of LEGACY_DROP_KEYS) {
  const r = db.query("DELETE FROM nodes WHERE k = ?").run(k);
  if (r.changes > 0) { dropped += r.changes; }
}

// 2) Drop hash-suffixed shadow voice nodes.
const r3 = db.query("DELETE FROM nodes WHERE k GLOB 'tru_voice_*' OR k GLOB 'tru_identity_*' OR k GLOB 'tru_mission_*' OR k GLOB 'tru_personal_mode_*' OR k GLOB 'answer_style_*' OR k GLOB 'human_conversation_rule_*'").run();
dropped += r3.changes;

// 3) Drop any row whose v contains the old tagline or tribunal language.
const scrub = db.query(
  "DELETE FROM nodes WHERE " +
    "v LIKE '%Dry Truth%' OR " +
    "v LIKE '%Steady Nudge%' OR " +
    "v LIKE '%dry_truth%' OR " +
    "v LIKE '%steady_nudge%' OR " +
    "v LIKE '%tribunal%' OR " +
    "v LIKE '%TRU_v43%' OR " +
    "v LIKE '%TRU v43%'"
).run();
dropped += scrub.changes;

// 4) Upsert the new frame nodes from JSON.
const ins = db.prepare(
  "INSERT INTO nodes (k, v, w, t, source, ref, greek_tr, greek_note, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(k) DO UPDATE SET v=excluded.v, w=excluded.w, t=excluded.t, source=excluded.source"
);

for (const n of j) {
  if (!FRAME_KEYS.has(n.k)) continue;
  ins.run(
    String(n.k),
    String(n.v ?? ""),
    Number(n.w ?? 0.95),
    n.t ? String(n.t) : "rule",
    n.source ? String(n.source) : "CERTIFIED",
    n.ref ? String(n.ref) : null,
    n.greek_tr ? String(n.greek_tr) : null,
    n.greek_note ? String(n.greek_note) : null,
    n.meta_json ? String(n.meta_json) : null,
  );
  console.log("upsert:", n.k, "→", String(n.v).slice(0, 70), "…");
  upserted++;
}

console.log("done. upserted=" + upserted + " dropped=" + dropped);
console.log("snapshot kept at:", snap);
