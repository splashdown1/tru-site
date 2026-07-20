#!/usr/bin/env bun
// Merge knowledge-pack nodes into the published brain JSON at
// /home/workspace/TRU/TRU_BRAIN_41.json so the live site's
// GHOST_BRAIN loader picks up the new cook + coding packs.
//
// Strategy:
//  1. Load the existing brain JSON (it is the source of truth for
//     all packs that were already in the live build).
//  2. Load every pack via loadKnowledgePacks() (the same loader the
//     rebuild script uses), keyed by packId.
//  3. For each pack node, if its key is already in the brain JSON,
//     leave the existing entry alone (preserves ordering + original
//     fields like greek_tr, greek_note, meta_json). Otherwise append
//     a clean entry with the pack-shaped fields.
//  4. Write the merged array back to the same path, sorted by k to
//     keep diffs small across rebuilds.
//
// We deliberately write a bare array, not {nodes:[...]} — the live
// server's ghost export expects a bare array (Array.isArray guard).

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadKnowledgePacks, type PackNode } from "../src/knowledge-packs";

const ROOT = dirname(import.meta.dir);
const BRAIN_PATH = join(ROOT, "..", "TRU", "TRU_BRAIN_41.json");
const BACKUP_PATH = `${BRAIN_PATH}.bak-${Date.now()}`;

type BrainNode = {
  k: string;
  v: string;
  w?: number;
  t?: string;
  source?: string;
  ref?: string;
  greek_tr?: string;
  greek_note?: string;
  meta_json?: string;
};

function main(): void {
  if (!existsSync(BRAIN_PATH)) {
    console.error(`[sync-brain] brain JSON missing at ${BRAIN_PATH}`);
    process.exit(1);
  }
  const original = JSON.parse(readFileSync(BRAIN_PATH, "utf8")) as BrainNode[];
  if (!Array.isArray(original)) {
    console.error("[sync-brain] brain JSON is not an array");
    process.exit(1);
  }
  const knownKeys = new Set<string>();
  for (const node of original) {
    if (node && typeof node.k === "string") knownKeys.add(node.k);
  }
  const beforeCount = original.length;

  const index = loadKnowledgePacks();
  let added = 0;
  let skipped = 0;
  for (const pack of index.packs) {
    const raw = readFileSync(pack.absPath, "utf8");
    const data = JSON.parse(raw) as unknown;
    const nodes = collectNodes(pack, data);
    for (const node of nodes) {
      if (knownKeys.has(node.k)) {
        skipped++;
        continue;
      }
      const entry: BrainNode = {
        k: node.k,
        v: node.v,
        w: typeof node.w === "number" ? node.w : pack.weight,
        t: node.t || pack.type,
        source: node.source || pack.source,
      };
      if (node.ref) entry.ref = node.ref;
      if (node.meta) entry.meta_json = JSON.stringify(node.meta);
      original.push(entry);
      knownKeys.add(node.k);
      added++;
    }
  }

  // Stable sort by key so the resulting file is diff-friendly.
  original.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));

  // Back up the original first, only if we will mutate it.
  if (added > 0) {
    copyFileSync(BRAIN_PATH, BACKUP_PATH);
    writeFileSync(BRAIN_PATH, JSON.stringify(original));
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        signature: index.signature,
        packs: index.summary.packs,
        before: beforeCount,
        added,
        skipped,
        after: original.length,
        path: BRAIN_PATH,
        backup: added > 0 ? BACKUP_PATH : null,
      },
      null,
      2,
    ),
  );
}

function collectNodes(pack: import("../src/knowledge-packs").KnowledgePack, raw: unknown): PackNode[] {
  // Re-use the loader's shape handlers. We re-implement the small
  // subset we care about rather than re-importing internals.
  if (!raw) return [];
  const out: PackNode[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const node = item as Record<string, unknown>;
      const k = String(node.k ?? "").trim();
      const v = String(node.v ?? "").trim();
      if (!k || !v) continue;
      out.push({
        k,
        v,
        t: typeof node.t === "string" ? node.t : pack.type,
        source: typeof node.source === "string" ? node.source : pack.source,
        w: typeof node.w === "number" ? node.w : pack.weight,
        packId: pack.id,
        ref: typeof node.ref === "string" ? node.ref : undefined,
      });
    }
    return out;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        // dictionary shape: list of entries {d,p,e,s}
        for (const entry of value) {
          if (!entry || typeof entry !== "object") continue;
          const e = entry as Record<string, unknown>;
          const gloss = String(e.d ?? "").trim();
          if (!gloss) continue;
          out.push({
            k: key,
            v: gloss,
            t: pack.type,
            source: pack.source,
            w: pack.weight,
            packId: pack.id,
            meta: { pos: e.p ?? null, examples: e.e ?? null, forms: e.s ?? null },
          });
        }
      } else if (typeof value === "string") {
        out.push({
          k: key,
          v: value,
          t: pack.type,
          source: pack.source,
          w: pack.weight,
          packId: pack.id,
        });
      }
    }
  }
  return out;
}

main();
