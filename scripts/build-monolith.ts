#!/usr/bin/env bun
// TRU · MEGA Monolith Builder v4 (300MB+ class)
// Stream a JSON array body to a file. Robust byte-level scanner that
// handles backslash escapes inside strings correctly.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync, symlinkSync, createReadStream, createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

const ROOT = join(process.cwd());
const TRU_ROOT = join(ROOT, "..", "TRU");
const GHOST_DIR = join(TRU_ROOT, "ghost");
const SHELL = join(ROOT, "src", "tru-ghost-shell.html");
const RUNTIME = join(ROOT, "src", "tru-ghost-runtime.template.js");
const TRIPWIRE = join(ROOT, "src", "tru-ghost-tripwire.js");
const TRU_LOGOS = join(ROOT, "..", "tru-logos-work", "data");
const COIL_DIR = join(ROOT, "..", "coil-system-local");

const BRAIN_41     = join(TRU_ROOT, "TRU_BRAIN_41.json");
const BRAIN_FULL   = join(TRU_ROOT, "merge_out", "TRU_BRAIN_FULL.min.json");
const KJV          = join(TRU_ROOT, "kjv_lookup.json");
const GREEK        = join(TRU_ROOT, "tru_greek_nt.json");
const TRANSLATION  = join(TRU_ROOT, "tru_translation.json");
const PRIMARIES    = join(TRU_ROOT, "primaries", "primaries.lock");
const MEMORY       = join(ROOT, "memory", "TRU_memory.json");
const STATE        = join(ROOT, "state", "TRU_latest.json");
const COIL_CHIP    = join(COIL_DIR, "COIL_MASTER_CHIP.json");
const STRONGS      = join(TRU_LOGOS, "strongs-data.json");
const XREF         = join(TRU_LOGOS, "xref-data.json");
const DICT         = join(TRU_LOGOS, "dict-data.json");
const ENCYC        = join(TRU_LOGOS, "encyclopedia-data.json");

const TMP = "/tmp/monolith-300";
if (existsSync(TMP)) {
  for (const f of readFileSync ? require("node:fs").readdirSync(TMP) : []) {
    try { require("node:fs").unlinkSync(join(TMP, f)); } catch {}
  }
} else {
  mkdirSync(TMP, { recursive: true });
}

function safeJson(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

function loadJsonOrNull(path, label) {
  if (!existsSync(path)) { console.error(`[mega] MISSING ${label}: ${path}`); return null; }
  const buf = readFileSync(path, "utf-8");
  console.log(`[mega] loaded ${label}: ${(statSync(path).size / 1048576).toFixed(2)} MB`);
  return JSON.parse(buf);
}

function logSize(label, bytes) {
  console.log(`[mega] ${label}: ${(bytes / 1048576).toFixed(2)} MB`);
}

// ── STREAM a JSON array's body (between [ and ]) to a file ──
//
// CORRECT escape handling: in JSON, inside a string, a backslash escapes
// the NEXT character only. \\, \", \n, \t, \uXXXX, \/ are all valid.
// \" does NOT close the string. " alone closes the string.
// The bug in earlier versions: we did `escape = true; continue;` which
// consumed the next char and *skipped* writing it. That worked for
// normal JSON but brain-merged data has \" inside strings — we wrote
// \" as " (consumed both) and the next char became a literal start of
// a new false string, which then swallowed more data.
//
// Fix: write the backslash AND the escaped char to the buffer (so the
// resulting JSON is unchanged), set `escape = true` only to remember
// "the next char is escaped, don't act on it", then clear escape *after*
// writing the escaped char.
async function streamBrainElements(src, dst) {
  const size = statSync(src).size;
  console.log(`[mega] streaming ${src} (${(size / 1048576).toFixed(2)} MB) → ${dst}…`);
  const input = createReadStream(src, { encoding: "utf-8", highWaterMark: 1 << 20 });
  const output = createWriteStream(dst, { encoding: "utf-8" });
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let foundOpen = false;
  let nodeCount = 0;
  let buf = "";
  const FLUSH = 1 << 20;

  return new Promise((res, rej) => {
    output.on("error", rej);
    input.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];

        // Inside a string: write everything verbatim (preserving \"),
        // only escape '<' to prevent </script> injection.
        if (inString) {
          // Always emit ch (and handle escapeNext to skip the action on the *next* char)
          if (escapeNext) {
            buf += ch;
            escapeNext = false;
            continue;
          }
          if (ch === "\\") {
            buf += ch;
            escapeNext = true;
            continue;
          }
          if (ch === "\"") {
            buf += ch;
            inString = false;
            continue;
          }
          if (ch === "<") {
            buf += "\\u003c";
            continue;
          }
          buf += ch;
          continue;
        }

        // Outside a string, before we've seen [
        if (!foundOpen) {
          if (ch === "[") foundOpen = true;
          continue;
        }

        // Outside a string, after [
        if (ch === "\"") { buf += "\""; inString = true; continue; }
        if (ch === "{") { buf += "{"; depth++; continue; }
        if (ch === "}") {
          buf += "}"; depth--;
          if (depth === 0) {
            nodeCount++;
            if (buf.length >= FLUSH) { output.write(buf); buf = ""; }
          }
          continue;
        }
        if (ch === "]" && depth === 0) {
          // Only end on the top-level close — avoid misfiring on
          // inner arrays like "t":[]
          if (buf.length) { output.write(buf); buf = ""; }
          output.end();
          res(nodeCount);
          return;
        }
        buf += ch;
      }
    });
    input.on("end", () => { if (buf.length) { output.write(buf); buf = ""; } output.end(); res(nodeCount); });
    input.on("error", rej);
  });
}

async function safeJsonToFile(obj, dst, label) {
  const s = safeJson(obj);
  writeFileSync(dst, s, "utf-8");
  logSize(label + " (encoded)", statSync(dst).size);
  return statSync(dst).size;
}

async function main() {
  console.log("[mega] === TRU MEGA Monolith Builder v4 ===");
  console.log("[mega] phase 1: stream-prep all sources…");

  const brain41Path = join(TMP, "brain41-elements.txt");
  const brain41Count = await streamBrainElements(BRAIN_41, brain41Path);
  console.log(`[mega]   brain_41: ${brain41Count.toLocaleString()} nodes`);

  let brainFullCount = 0;
  if (existsSync(BRAIN_FULL)) {
    const brainFullPath = join(TMP, "brainfull-elements.txt");
    brainFullCount = await streamBrainElements(BRAIN_FULL, brainFullPath);
    console.log(`[mega]   brain_full: ${brainFullCount.toLocaleString()} nodes`);
  }

  await safeJsonToFile(loadJsonOrNull(COIL_CHIP, "coil"), join(TMP, "coil.json"), "coil");
  await safeJsonToFile(loadJsonOrNull(STRONGS, "strongs"), join(TMP, "strongs.json"), "strongs");
  await safeJsonToFile(loadJsonOrNull(XREF, "xref"), join(TMP, "xref.json"), "xref");
  await safeJsonToFile(loadJsonOrNull(DICT, "dict"), join(TMP, "dict.json"), "dict");
  await safeJsonToFile(loadJsonOrNull(ENCYC, "encyc"), join(TMP, "encyc.json"), "encyc");

  const kjv = loadJsonOrNull(KJV, "kjv") || {};
  const greek = loadJsonOrNull(GREEK, "greek");
  const translation = loadJsonOrNull(TRANSLATION, "translation");
  const memory = loadJsonOrNull(MEMORY, "memory") || { entries: [], version: 0 };
  const state = loadJsonOrNull(STATE, "session") || {};
  const primariesLock = existsSync(PRIMARIES) ? readFileSync(PRIMARIES, "utf-8").trim() : "UNAVAILABLE";

  const meta = {
    baked: new Date().toISOString(),
    brain41: brain41Count,
    brainFull: brainFullCount,
    kjv: Object.keys(kjv).length,
    greek: greek?.meta?.verses ?? 0,
    translation: translation?.verses_with_translation ?? translation?.total_verses ?? 0,
    memory: memory.entries?.length ?? 0,
    primariesLock: primariesLock.slice(0, 16) + "…",
  };

  await safeJsonToFile(kjv, join(TMP, "kjv.json"), "kjv");
  await safeJsonToFile(greek, join(TMP, "greek.json"), "greek");
  await safeJsonToFile(translation, join(TMP, "translation.json"), "translation");
  await safeJsonToFile(memory, join(TMP, "memory.json"), "memory");
  await safeJsonToFile(state, join(TMP, "state.json"), "state");
  await safeJsonToFile(meta, join(TMP, "meta.json"), "meta");
  await safeJsonToFile(primariesLock, join(TMP, "primaries.json"), "primaries");

  console.log("[mega] phase 2: load shell + runtime + tripwire…");
  const shell = readFileSync(SHELL, "utf-8");
  let runtime = readFileSync(RUNTIME, "utf-8");
  const tripwire = readFileSync(TRIPWIRE, "utf-8");
  runtime = runtime.replace("// __TRIPWIRE_INJECT__", tripwire);

  const safeIn = (label, payload) => { runtime = runtime.split(label).join(payload); };

  safeIn("const BRAIN   = __BRAIN__;", "/* BRAIN_INJECT_OPEN */ const BRAIN = [ /* BRAIN_BODY_INJECT */ ];");
  safeIn("const KJV     = __KJV__;", "const KJV     = " + safeJson(kjv) + ";");
  safeIn("const SESSION = __SESSION__ || {};", "const SESSION = " + safeJson(state) + " || {};");
  safeIn("const META    = __META__ || {};", "const META    = " + safeJson(meta) + " || {};");
  safeIn("const BAKED_MEMORY = __MEMORY__ || { entries: [], version: 0 };", "const BAKED_MEMORY = " + safeJson(memory) + ";");
  safeIn("(typeof __GREEK__ !== \"undefined\") ? __GREEK__ : null", safeJson(greek));
  safeIn("(typeof __TRANSLATION__ !== \"undefined\") ? __TRANSLATION__ : null", safeJson(translation));
  safeIn("__PRIMARIES__", safeJson(primariesLock));

  const appendix = `
  // ── MEGA BUILD APPENDIX ──
  const COIL_DATA  = ${readFileSync(join(TMP, "coil.json"), "utf-8")};
  const STRONGS    = ${readFileSync(join(TMP, "strongs.json"), "utf-8")};
  const XREF       = ${readFileSync(join(TMP, "xref.json"), "utf-8")};
  const DICT       = ${readFileSync(join(TMP, "dict.json"), "utf-8")};
  const ENCYC      = ${readFileSync(join(TMP, "encyc.json"), "utf-8")};
  if (typeof document !== 'undefined') {
    try {
      var statDict = document.getElementById("statDict");
      if (statDict && DICT && (DICT.entries || DICT.words)) statDict.textContent = (DICT.entries || DICT.words).length.toLocaleString();
      var statEncyc = document.getElementById("statEncyc");
      if (statEncyc && ENCYC && (ENCYC.entries || ENCYC.articles)) statEncyc.textContent = (ENCYC.entries || ENCYC.articles).length.toLocaleString();
      var statStrongs = document.getElementById("statStrongs");
      if (statStrongs && STRONGS) statStrongs.textContent = (STRONGS.length || Object.keys(STRONGS).length || 0).toLocaleString();
      var statXref = document.getElementById("statXref");
      if (statXref && XREF) statXref.textContent = (XREF.length || Object.keys(XREF).length || 0).toLocaleString();
      var statCoil = document.getElementById("statCoil");
      if (statCoil && COIL_DATA) statCoil.textContent = (Object.keys(COIL_DATA).length || 1).toLocaleString();
    } catch (e) {}
  }
  var _BRAIN_DEDUP = (function () {
    var byKey = new Map();
    for (var i = 0; i < BRAIN.length; i++) {
      var n = BRAIN[i];
      if (!n || !n.k) continue;
      var existing = byKey.get(n.k);
      if (!existing || (n.w || 0) > (existing.w || 0)) byKey.set(n.k, n);
    }
    return Array.from(byKey.values());
  })();
  BRAIN.length = 0;
  for (var _di = 0; _di < _BRAIN_DEDUP.length; _di++) BRAIN.push(_BRAIN_DEDUP[_di]);
  if (typeof document !== 'undefined') {
    try {
      var sb = document.getElementById("statBrain");
      if (sb) sb.textContent = BRAIN.length.toLocaleString();
    } catch (e) {}
  }
  function lookupStrongs(num) {
    if (!STRONGS) return null;
    var key = String(num).toUpperCase();
    if (STRONGS[key]) return STRONGS[key];
    if (STRONGS["G" + key]) return STRONGS["G" + key];
    if (STRONGS["H" + key]) return STRONGS["H" + key];
    if (STRONGS[num]) return STRONGS[num];
    return null;
  }
  function lookupXref(ref) {
    if (!XREF || !ref) return [];
    var k = String(ref).toLowerCase();
    var k2 = k.replace(/\\s+/g, "");
    if (XREF[k]) return XREF[k];
    if (XREF[k2]) return XREF[k2];
    return [];
  }
  try { window.__TRU_MEGA__ = true; } catch (e) {}
`;

  const IIFE_CLOSE = "})();";
  const lastClose = runtime.lastIndexOf(IIFE_CLOSE);
  if (lastClose === -1) { console.error("[mega] FATAL: IIFE close not found"); process.exit(1); }
  runtime = runtime.slice(0, lastClose) + appendix + runtime.slice(lastClose);

  console.log("[mega] phase 3: assemble final HTML…");
  const shellMarker = "/* __TRU_GHOST_RUNTIME__ */";
  const shellIdx = shell.indexOf(shellMarker);
  if (shellIdx === -1) { console.error("[mega] FATAL: shell marker not found"); process.exit(1); }
  const shellHead = shell.slice(0, shellIdx);
  const shellTail = shell.slice(shellIdx + shellMarker.length);

  const brainOpenMarker = "/* BRAIN_INJECT_OPEN */ const BRAIN = [ /* BRAIN_BODY_INJECT */ ];";
  if (!runtime.includes(brainOpenMarker)) { console.error("[mega] FATAL: brain marker missing"); process.exit(1); }
  runtime = runtime.split(brainOpenMarker).join("/* BRAIN_STREAM_INJECT */");

  if (!existsSync(GHOST_DIR)) mkdirSync(GHOST_DIR, { recursive: true });
  const ts = meta.baked.replace(/[:.]/g, "-");
  const outPath = join(GHOST_DIR, `TRU_HOLO_GHOST_${ts}.html`);
  const out = createWriteStream(outPath);

  out.write(shellHead);
  out.write("const BRAIN = [\n");
  out.write("/* brain_41 */\n");
  await pipeline(createReadStream(brain41Path), out, { end: false });
  out.write(",\n/* brain_full */\n");
  if (brainFullCount > 0 && existsSync(join(TMP, "brainfull-elements.txt"))) {
    await pipeline(createReadStream(join(TMP, "brainfull-elements.txt")), out, { end: false });
  }
  out.write("\n];\n");
  out.write(runtime);
  out.write(shellTail);
  await new Promise((res) => out.end(res));

  const bytes = statSync(outPath).size;
  const latest = join(GHOST_DIR, "TRU_HOLO_GHOST_LATEST.html");
  try { unlinkSync(latest); } catch {}
  symlinkSync(outPath, latest);

  console.log(`[mega] wrote ${outPath}`);
  console.log(`[mega] size: ${(bytes / 1048576).toFixed(2)} MB (${bytes.toLocaleString()} bytes)`);
  console.log(`[mega] nodes: brain_41=${brain41Count.toLocaleString()} · brain_full=${brainFullCount.toLocaleString()} · kjv=${meta.kjv.toLocaleString()} · greek=${meta.greek} · trans=${meta.translation} · memory=${meta.memory}`);
  console.log(`[mega] linked ${latest}`);
  console.log("[mega] done.");
}

main().catch((err) => { console.error("[mega] FATAL:", err); process.exit(1); });
