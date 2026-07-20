#!/usr/bin/env bun
import { Database } from "bun:sqlite";

const DB = "/home/workspace/tru/state/tru_brain.db";
const q = process.argv[2] || "bake chicken";
const qTokens = q.toLowerCase().split(/\W+/).filter((t) => t.length >= 3);
console.log("q:", q, "tokens:", qTokens);

const db = new Database(DB, { readonly: true });

// Replicate collectCandidates: qNorm exact + qRaw substring + per-token OR + type group.
const qNorm = q.toLowerCase().replace(/[\u2019'`_]/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const qRaw = q.toLowerCase();

const out = new Map<string, any>();
const push = (rows: any[]) => { for (const r of rows) if (!out.has(r.k)) out.set(r.k, r); };

// 1. exact
push(db.prepare(
  "SELECT k, v, t, source, ref, w FROM nodes WHERE LOWER(k) = ? OR LOWER(REPLACE(k, '_', ' ')) = ? OR LOWER(v) = ? OR LOWER(ref) = ? ORDER BY w DESC LIMIT 20"
).all(qNorm, qNorm, qNorm, qNorm) as any[]);

// 2. LIKE %qRaw%
push(db.prepare(
  "SELECT k, v, t, source, ref, w FROM nodes WHERE LOWER(k) LIKE ? OR LOWER(REPLACE(k, '_', ' ')) LIKE ? OR LOWER(v) LIKE ? OR LOWER(ref) LIKE ? ORDER BY w DESC LIMIT 80"
).all(`%${qRaw}%`, `%${qRaw}%`, `%${qRaw}%`, `%${qRaw}%`) as any[]);

// 3. per-token
if (qTokens.length > 0) {
  const clauses = qTokens.map(() => "(LOWER(k) LIKE ? OR LOWER(REPLACE(k, '_', ' ')) LIKE ? OR LOWER(v) LIKE ? OR LOWER(ref) LIKE ?)").join(" OR ");
  const params: any[] = [];
  for (const t of qTokens) params.push(`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`);
  push(db.prepare(`SELECT k, v, t, source, ref, w FROM nodes WHERE ${clauses} ORDER BY w DESC LIMIT 120`).all(...params) as any[]);
}

const rows = Array.from(out.values());
console.log("candidates:", rows.length);

// Score
const scored = rows.map((node) => {
  const keyNorm = node.k.toLowerCase().replace(/_/g, " ");
  const valueNorm = (node.v || "").toLowerCase();
  const refNorm = (node.ref || "").toLowerCase();
  let score = 0;
  if (keyNorm === qNorm) score += 180;
  else if (keyNorm.startsWith(qNorm) && qNorm.length >= 2) score += 110;
  else if (keyNorm.includes(qNorm) && qNorm.length >= 2) score += 90;
  if (valueNorm.includes(qNorm) && qNorm.length >= 2) score += 70;
  if (refNorm.includes(qNorm) && qNorm.length >= 2) score += 45;
  // token coverage
  const hay = new Set(`${node.k} ${node.v} ${node.ref || ""}`.toLowerCase().split(/\W+/).filter(t => t.length > 1));
  let hits = 0;
  for (const t of qTokens) if (hay.has(t)) hits++;
  if (hits > 0) {
    score += (hits / Math.max(qTokens.length, hay.size)) * 80 + hits * 2;
  }
  // w weight bump
  score += Number(node.w ?? 0) * 2;
  return { ...node, score, hits };
});
scored.sort((a, b) => b.score - a.score);
for (const r of scored.slice(0, 15)) {
  console.log(`[${r.source} · ${r.t} · w=${r.w}] hits=${r.hits} score=${r.score.toFixed(0)} k=${r.k}`);
  console.log("   ", (r.v || "").slice(0, 110));
}
db.close();
