import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type QueryClass = "identity" | "definition" | "dilemma" | "topic";

export type PackShape =
  | "array-nodes"
  | "kjv-verses"
  | "dictionary-map"
  | "xref-map"
  | "strongs-entries"
  | "strongs-index"
  | "entry-map";

export type KnowledgePack = {
  id: string;
  file: string;
  shape: PackShape;
  source: string;
  type: string;
  weight: number;
  description?: string;
  boosts: Record<QueryClass, number>;
};

type PackManifest = {
  version: number;
  packs: KnowledgePack[];
};

export type LoadedPack = KnowledgePack & {
  absPath: string;
  bytes: number;
  mtimeMs: number;
  hash: string;
};

export type PackNode = {
  k: string;
  v: string;
  t: string;
  source: string;
  w: number;
  packId: string;
  ref?: string;
  meta?: Record<string, unknown>;
};

export type PackIndex = {
  manifestVersion: number;
  packs: LoadedPack[];
  signature: string;
  summary: {
    packs: number;
    bytes: number;
    nodes: number;
  };
};

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(ROOT, "..", "knowledge-pack-manifest.json");

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeText(path: string): string {
  return readFileSync(path, "utf8");
}

function shaLike(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + (h1 << 1);
    h2 = Math.imul(h2, 0x45d9f3b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

export function loadManifest(): PackManifest {
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as PackManifest;
  if (!raw || !Array.isArray(raw.packs)) {
    throw new Error("invalid knowledge pack manifest");
  }
  return raw;
}

function resolvePackPath(file: string): string {
  return file.startsWith("/") ? file : join(dirname(MANIFEST_PATH), file);
}

export function loadPacks(): LoadedPack[] {
  const manifest = loadManifest();
  return manifest.packs.map((pack) => {
    const absPath = resolvePackPath(pack.file);
    if (!existsSync(absPath)) {
      throw new Error(`missing knowledge pack: ${pack.id} (${absPath})`);
    }
    const stat = statSync(absPath);
    return {
      ...pack,
      absPath,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      hash: shaLike(`${pack.id}:${pack.file}:${pack.shape}:${pack.source}:${pack.type}:${pack.weight}:${stat.size}:${stat.mtimeMs}`),
    };
  });
}

export function loadPackIndexMeta(): PackIndex {
  const packs = loadPacks();
  const index: PackIndex = {
    manifestVersion: loadManifest().version,
    packs,
    signature: "",
    summary: {
      packs: packs.length,
      bytes: packs.reduce((sum, p) => sum + p.bytes, 0),
      nodes: 0,
    },
  };
  index.signature = packSignature(index);
  return index;
}

function normaliseText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function verseToKey(ref: string): string {
  const m = ref.toLowerCase().trim().match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!m) return ref.toLowerCase().replace(/\s+/g, " ");
  const book = m[1].replace(/\s+/g, " ");
  return `${book} ${m[2]}:${m[3]}`;
}

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function makeNode(pack: KnowledgePack, k: string, v: string, extra: Partial<PackNode> = {}): PackNode {
  return {
    k,
    v,
    t: extra.t || pack.type,
    source: extra.source || pack.source,
    w: extra.w ?? pack.weight,
    packId: pack.id,
    ref: extra.ref,
    meta: extra.meta,
  };
}

function fromArrayNodes(pack: KnowledgePack, raw: unknown): PackNode[] {
  if (!Array.isArray(raw)) return [];
  const out: PackNode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const node = item as Record<string, unknown>;
    const k = normaliseText(node.k);
    const v = normaliseText(node.v);
    if (!k || !v) continue;
    const t = typeof node.t === "string" ? node.t : pack.type;
    const source = typeof node.source === "string" ? node.source : pack.source;
    const w = typeof node.w === "number" ? node.w : pack.weight;
    const ref = typeof node.ref === "string" ? node.ref : undefined;
    const meta = { ...node };
    delete (meta as Record<string, unknown>).k;
    delete (meta as Record<string, unknown>).v;
    delete (meta as Record<string, unknown>).t;
    delete (meta as Record<string, unknown>).source;
    delete (meta as Record<string, unknown>).w;
    delete (meta as Record<string, unknown>).ref;
    out.push(makeNode(pack, k, v, { t, source, w, ref, meta }));
  }
  return out;
}

function fromKjv(pack: KnowledgePack, raw: unknown): PackNode[] {
  if (!Array.isArray(raw)) return [];
  const out: PackNode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const verse = item as Record<string, unknown>;
    const ref = normaliseText(verse.ref);
    const text = normaliseText(verse.text);
    if (!ref || !text) continue;
    out.push(makeNode(pack, verseToKey(ref), text, { t: "bible", ref, source: pack.source, w: pack.weight }));
  }
  return out;
}

function fromDictionary(pack: KnowledgePack, raw: unknown): PackNode[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: PackNode[] = [];
  for (const [headword, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const gloss = normaliseText(e.d);
      if (!gloss) continue;
      const forms = Array.isArray(e.s) ? e.s.filter((s) => typeof s === "string") as string[] : [];
      const k = `${headword}`;
      out.push(makeNode(pack, k, gloss, { t: "knowledge", source: pack.source, w: pack.weight, meta: { pos: e.p ?? null, examples: e.e ?? null, forms } }));
    }
  }
  return out;
}

function fromXref(pack: KnowledgePack, raw: unknown): PackNode[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: PackNode[] = [];
  for (const [ref, links] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(links)) continue;
    const list = links.filter((v) => typeof v === "string") as string[];
    if (!list.length) continue;
    out.push(makeNode(pack, `xref:${ref}`, list.join(" · "), { t: "knowledge", source: pack.source, w: pack.weight, ref, meta: { links: list } }));
  }
  return out;
}

function fromStrongsEntries(pack: KnowledgePack, raw: unknown): PackNode[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: PackNode[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const e = value as Record<string, unknown>;
    const lemma = normaliseText(e.l || e.t || key);
    const def = normaliseText(e.d || e.u || e.k);
    if (!lemma || !def) continue;
    out.push(makeNode(pack, key.toLowerCase(), `${lemma} — ${def}`, { t: "lexicon", source: pack.source, w: pack.weight, meta: { translit: e.t ?? null, root: e.r ?? null, usage: e.u ?? null, kind: e.p ?? null } }));
  }
  return out;
}

function fromStrongsIndex(pack: KnowledgePack, raw: unknown): PackNode[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: PackNode[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const e = value as Record<string, unknown>;
    const count = typeof e.c === "number" ? e.c : 0;
    const verses = Array.isArray(e.v) ? e.v.filter((v) => typeof v === "string") as string[] : [];
    if (!count && !verses.length) continue;
    out.push(makeNode(pack, key.toLowerCase(), verses.slice(0, 24).join(" · "), { t: "lexicon", source: pack.source, w: pack.weight, meta: { count, verses } }));
  }
  return out;
}

function fromEntryMap(pack: KnowledgePack, raw: unknown): PackNode[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: PackNode[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const text = typeof value === "string" ? value : normaliseText(value);
    if (!text) continue;
    out.push(makeNode(pack, key, text, { t: pack.type, source: pack.source, w: pack.weight }));
  }
  return out;
}

export function packSignature(index: PackIndex): string {
  const payload = {
    manifestVersion: index.manifestVersion,
    packs: index.packs.map((p) => ({ id: p.id, file: p.file, shape: p.shape, source: p.source, type: p.type, weight: p.weight, bytes: p.bytes, mtimeMs: p.mtimeMs, hash: p.hash })),
  };
  return shaLike(stableStringify(payload));
}

export function loadKnowledgePacks(): PackIndex {
  const packs = loadPacks();
  let nodes = 0;
  for (const pack of packs) {
    const raw = JSON.parse(readFileSync(pack.absPath, "utf8"));
    switch (pack.shape) {
      case "array-nodes":
        nodes += fromArrayNodes(pack, raw).length;
        break;
      case "kjv-verses":
        nodes += fromKjv(pack, raw).length;
        break;
      case "dictionary-map":
        nodes += fromDictionary(pack, raw).length;
        break;
      case "xref-map":
        nodes += fromXref(pack, raw).length;
        break;
      case "strongs-entries":
        nodes += fromStrongsEntries(pack, raw).length;
        break;
      case "strongs-index":
        nodes += fromStrongsIndex(pack, raw).length;
        break;
      case "entry-map":
        nodes += fromEntryMap(pack, raw).length;
        break;
      default:
        throw new Error(`unsupported pack shape: ${pack.shape}`);
    }
  }
  const index: PackIndex = {
    manifestVersion: loadManifest().version,
    packs,
    signature: "",
    summary: {
      packs: packs.length,
      bytes: packs.reduce((sum, p) => sum + p.bytes, 0),
      nodes,
    },
  };
  index.signature = packSignature(index);
  return index;
}

export function scorePackMatch(pack: KnowledgePack, queryClass: QueryClass): number {
  return pack.boosts[queryClass] ?? 0;
}

export function getPackRoot(): string {
  return ROOT;
}
