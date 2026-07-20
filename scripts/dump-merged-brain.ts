#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKnowledgePacks, type PackNode } from "../src/knowledge-packs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2] || join(ROOT, "..", "..", "TRU", "TRU_BRAIN_MERGED.json");
mkdirSync(dirname(outPath), { recursive: true });

const index = loadKnowledgePacks();
const out: PackNode[] = [];
for (const pack of index.packs) {
  const raw = JSON.parse(readFileSync(pack.absPath, "utf8"));
  switch (pack.shape) {
    case "array-nodes": {
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
      }
      break;
    }
    case "kjv-verses": {
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (!item || typeof item !== "object") continue;
          const verse = item as Record<string, unknown>;
          const ref = String(verse.ref ?? "").trim();
          const text = String(verse.text ?? "").trim();
          if (!ref || !text) continue;
          out.push({ k: ref.toLowerCase(), v: text, t: "bible", source: pack.source, w: pack.weight, packId: pack.id, ref });
        }
      }
      break;
    }
    case "dictionary-map": {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [headword, entries] of Object.entries(raw as Record<string, unknown>)) {
          if (!Array.isArray(entries)) continue;
          for (const entry of entries) {
            if (!entry || typeof entry !== "object") continue;
            const e = entry as Record<string, unknown>;
            const gloss = String(e.d ?? "").trim();
            if (!gloss) continue;
            out.push({ k: headword, v: gloss, t: "knowledge", source: pack.source, w: pack.weight, packId: pack.id });
          }
        }
      }
      break;
    }
    case "xref-map": {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [ref, links] of Object.entries(raw as Record<string, unknown>)) {
          if (!Array.isArray(links)) continue;
          const list = links.filter((v) => typeof v === "string") as string[];
          if (!list.length) continue;
          out.push({ k: `xref:${ref}`, v: list.join(" · "), t: "knowledge", source: pack.source, w: pack.weight, packId: pack.id, ref });
        }
      }
      break;
    }
    case "strongs-entries": {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (!value || typeof value !== "object") continue;
          const e = value as Record<string, unknown>;
          const lemma = String(e.l || e.t || key).trim();
          const def = String(e.d || e.u || e.k).trim();
          if (!lemma || !def) continue;
          out.push({ k: key.toLowerCase(), v: `${lemma} — ${def}`, t: "lexicon", source: pack.source, w: pack.weight, packId: pack.id });
        }
      }
      break;
    }
    case "strongs-index": {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (!value || typeof value !== "object") continue;
          const e = value as Record<string, unknown>;
          const verses = Array.isArray(e.v) ? (e.v.filter((v) => typeof v === "string") as string[]) : [];
          if (!verses.length) continue;
          out.push({ k: key.toLowerCase(), v: verses.slice(0, 24).join(" · "), t: "lexicon", source: pack.source, w: pack.weight, packId: pack.id });
        }
      }
      break;
    }
    case "entry-map": {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          const text = typeof value === "string" ? value : String(value ?? "").trim();
          if (!text) continue;
          out.push({ k: key, v: text, t: pack.type, source: pack.source, w: pack.weight, packId: pack.id });
        }
      }
      break;
    }
  }
}

writeFileSync(outPath, JSON.stringify(out));
const seen = new Set<string>();
for (const n of out) if (n.k) seen.add(n.k);
console.log(JSON.stringify({ ok: true, path: outPath, packs: index.packs.length, nodes: out.length, unique: seen.size, bytes: existsSync(outPath) ? require("node:fs").statSync(outPath).size : 0 }, null, 2));
