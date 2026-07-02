#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKnowledgePacks, scorePackMatch, type LoadedPack, type PackNode, type QueryClass } from "../src/knowledge-packs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(ROOT, "..", "state");
const DB_PATH = join(STATE_DIR, "tru_brain.db");
const CACHE_PATH = join(STATE_DIR, "knowledge-pack-cache.json");

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function parseQueryClass(type: string): QueryClass {
  const t = type.toLowerCase();
  if (t.includes("identity")) return "identity";
  if (t.includes("dilemma")) return "dilemma";
  if (t.includes("definition") || t.includes("fact") || t.includes("knowledge") || t.includes("concept") || t.includes("lexicon")) return "definition";
  return "topic";
}

function normaliseText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function resolvePackPath(absPath: string): string {
  return absPath;
}

function loadCache(): { signature?: string } {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(signature: string): void {
  writeFileSync(CACHE_PATH, JSON.stringify({ signature, updatedAt: new Date().toISOString() }, null, 2));
}

function shouldRebuild(signature: string): boolean {
  const cache = loadCache();
  return cache.signature !== signature || !existsSync(DB_PATH);
}

function main(): void {
  ensureDir(STATE_DIR);
  const index = loadKnowledgePacks();
  if (!shouldRebuild(index.signature)) {
    console.log(JSON.stringify({ ok: true, rebuilt: false, reason: "signature unchanged", signature: index.signature, packs: index.summary.packs, bytes: index.summary.bytes, nodes: index.summary.nodes }, null, 2));
    return;
  }

  const db = new Database(DB_PATH);
  db.exec(`
    DROP TABLE IF EXISTS nodes;
    CREATE TABLE nodes (
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
    CREATE INDEX IF NOT EXISTS idx_nodes_v ON nodes(v);
    CREATE INDEX IF NOT EXISTS idx_nodes_w ON nodes(w DESC);
    CREATE INDEX IF NOT EXISTS idx_nodes_t ON nodes(t);
    CREATE INDEX IF NOT EXISTS idx_nodes_source ON nodes(source);
  `);

  const insert = db.prepare("INSERT OR REPLACE INTO nodes (k, v, w, t, source, ref, greek_tr, greek_note, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  let count = 0;
  let packCount = 0;
  for (const pack of index.packs) {
    const raw = JSON.parse(readFileSync(pack.absPath, "utf8"));
    const nodes: PackNode[] = [];
    switch (pack.shape) {
      case "array-nodes":
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (!item || typeof item !== "object") continue;
            const node = item as Record<string, unknown>;
            const k = normaliseText(node.k);
            const v = normaliseText(node.v);
            if (!k || !v) continue;
            nodes.push({
              k,
              v,
              t: typeof node.t === "string" ? node.t : pack.type,
              source: typeof node.source === "string" ? node.source : pack.source,
              w: typeof node.w === "number" ? node.w : pack.weight,
              packId: pack.id,
              ref: typeof node.ref === "string" ? node.ref : undefined,
              meta: Object.fromEntries(Object.entries(node).filter(([key]) => !["k", "v", "t", "source", "w", "ref"].includes(key))),
            });
          }
        }
        break;
      case "kjv-verses":
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (!item || typeof item !== "object") continue;
            const verse = item as Record<string, unknown>;
            const ref = normaliseText(verse.ref);
            const text = normaliseText(verse.text);
            if (!ref || !text) continue;
            nodes.push({
              k: ref.toLowerCase(),
              v: text,
              t: "bible",
              source: pack.source,
              w: pack.weight,
              packId: pack.id,
              ref,
            });
          }
        }
        break;
      case "dictionary-map":
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [headword, entries] of Object.entries(raw as Record<string, unknown>)) {
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
              if (!entry || typeof entry !== "object") continue;
              const e = entry as Record<string, unknown>;
              const gloss = normaliseText(e.d);
              if (!gloss) continue;
              nodes.push({
                k: headword,
                v: gloss,
                t: "knowledge",
                source: pack.source,
                w: pack.weight,
                packId: pack.id,
                meta: { pos: e.p ?? null, examples: e.e ?? null, forms: e.s ?? null },
              });
            }
          }
        }
        break;
      case "xref-map":
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [ref, links] of Object.entries(raw as Record<string, unknown>)) {
            if (!Array.isArray(links)) continue;
            const list = links.filter((v) => typeof v === "string") as string[];
            if (!list.length) continue;
            nodes.push({
              k: `xref:${ref}`,
              v: list.join(" · "),
              t: "knowledge",
              source: pack.source,
              w: pack.weight,
              packId: pack.id,
              ref,
              meta: { links: list },
            });
          }
        }
        break;
      case "strongs-entries":
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (!value || typeof value !== "object") continue;
            const e = value as Record<string, unknown>;
            const lemma = normaliseText(e.l || e.t || key);
            const def = normaliseText(e.d || e.u || e.k);
            if (!lemma || !def) continue;
            nodes.push({
              k: key.toLowerCase(),
              v: `${lemma} — ${def}`,
              t: "lexicon",
              source: pack.source,
              w: pack.weight,
              packId: pack.id,
              meta: { translit: e.t ?? null, root: e.r ?? null, usage: e.u ?? null, kind: e.p ?? null },
            });
          }
        }
        break;
      case "strongs-index":
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (!value || typeof value !== "object") continue;
            const e = value as Record<string, unknown>;
            const count = typeof e.c === "number" ? e.c : 0;
            const verses = Array.isArray(e.v) ? e.v.filter((v) => typeof v === "string") as string[] : [];
            if (!count && !verses.length) continue;
            nodes.push({
              k: key.toLowerCase(),
              v: verses.slice(0, 24).join(" · "),
              t: "lexicon",
              source: pack.source,
              w: pack.weight,
              packId: pack.id,
              meta: { count, verses },
            });
          }
        }
        break;
      case "entry-map":
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            const text = typeof value === "string" ? value : normaliseText(value);
            if (!text) continue;
            nodes.push({ k: key, v: text, t: pack.type, source: pack.source, w: pack.weight, packId: pack.id });
          }
        }
        break;
    }

    const classType = parseQueryClass(pack.type);
    for (const node of nodes) {
      const weight = Math.max(node.w, pack.weight + scorePackMatch(pack, classType) * 0.01);
      insert.run(node.k, node.v, weight, node.t, node.source, node.ref || null, null, null, node.meta ? JSON.stringify(node.meta) : null);
      count += 1;
    }
    packCount += 1;
  }

  db.close();
  saveCache(index.signature);
  console.log(JSON.stringify({ ok: true, rebuilt: true, db: DB_PATH, signature: index.signature, packs: packCount, nodes: count, bytes: index.summary.bytes }, null, 2));
}

main();
