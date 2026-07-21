#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TRU_ROOT = join(ROOT, "..", "TRU");
const GHOST_DIR = join(TRU_ROOT, "ghost");
const shellPath = join(ROOT, "src", "tru-ghost-shell.html");
const runtimePath = join(ROOT, "src", "tru-ghost-runtime.template.js");
const tripwirePath = join(ROOT, "src", "tru-ghost-tripwire.js");
const brainPath = join(TRU_ROOT, "TRU_BRAIN_41.json");
const kjvPath = join(TRU_ROOT, "kjv_lookup.json");
const memoryPath = join(ROOT, "memory", "TRU_memory.json");
const statePath = join(ROOT, "state", "TRU_latest.json");
const lockPath = join(TRU_ROOT, "primaries", "primaries.lock");
const outputPath = join(GHOST_DIR, "TRU_CLEAN.html");

function readJson(path: string, fallback: unknown) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const brain = readJson(brainPath, []);
const kjv = readJson(kjvPath, {});
const memory = readJson(memoryPath, { entries: [], version: 0 });
const state = readJson(statePath, {});
const shell = readFileSync(shellPath, "utf8");
let runtime = readFileSync(runtimePath, "utf8");
const tripwire = readFileSync(tripwirePath, "utf8");
const primariesLock = existsSync(lockPath) ? readFileSync(lockPath, "utf8").trim() : "UNAVAILABLE";
const baked = new Date().toISOString();
const meta = {
  baked,
  brain: Array.isArray(brain) ? brain.length : 0,
  kjv: Object.keys(kjv).length,
  memory: memory?.entries?.length ?? 0,
  uploads: Array.isArray(state?.uploads) ? state.uploads.length : 0,
  build: "TRU_CLEAN",
};

runtime = runtime.replace("// __TRIPWIRE_INJECT__", tripwire);
runtime = runtime
  .split("__BRAIN__").join(scriptJson(brain))
  .split("__KJV__").join(scriptJson(kjv))
  .split("__SESSION__").join(scriptJson(state))
  .split("__MEMORY__").join(scriptJson(memory))
  .split("__META__").join(scriptJson(meta))
  .split("__PRIMARIES__").join(scriptJson(primariesLock));

if (!runtime.includes("const BRAIN")) throw new Error("brain injection failed");
if (!runtime.includes("const KJV")) throw new Error("KJV injection failed");
if (!shell.includes("/* __TRU_GHOST_RUNTIME__ */")) throw new Error("shell marker missing");

mkdirSync(GHOST_DIR, { recursive: true });
const html = shell.replace("/* __TRU_GHOST_RUNTIME__ */", runtime);
writeFileSync(outputPath, html, "utf8");
const bytes = statSync(outputPath).size;
console.log(JSON.stringify({ ok: true, outputPath, bytes, megabytes: Number((bytes / 1048576).toFixed(2)), brain: meta.brain, kjv: meta.kjv, baked }, null, 2));
