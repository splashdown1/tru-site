#!/usr/bin/env bun
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { once } from "node:events";
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
const tempPath = `${outputPath}.tmp`;

function readJson(path: string, fallback: unknown) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

function scriptJson(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

async function writeChunk(output: ReturnType<typeof createWriteStream>, chunk: string) {
  if (!output.write(chunk, "utf8")) await once(output, "drain");
}

async function countObjects(path: string) {
  let count = 0;
  let inString = false;
  let escaped = false;
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    for (const char of chunk) {
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === "{") {
        count += 1;
      }
    }
  }
  return count;
}

async function streamJson(path: string, output: ReturnType<typeof createWriteStream>) {
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    await writeChunk(output, chunk.replaceAll("<", "\\u003c"));
  }
}

const brainBytes = statSync(brainPath).size;
const brainCount = await countObjects(brainPath);
const kjv = readJson(kjvPath, {}) as Record<string, unknown>;
const memory = readJson(memoryPath, { entries: [], version: 0 }) as any;
const state = readJson(statePath, {}) as any;
const shell = readFileSync(shellPath, "utf8");
let runtime = readFileSync(runtimePath, "utf8");
const tripwire = readFileSync(tripwirePath, "utf8");
const primariesLock = existsSync(lockPath) ? readFileSync(lockPath, "utf8").trim() : "UNAVAILABLE";
const baked = new Date().toISOString();
const meta = {
  baked,
  brain: brainCount,
  kjv: Object.keys(kjv).length,
  memory: memory?.entries?.length ?? 0,
  uploads: Array.isArray(state?.uploads) ? state.uploads.length : 0,
  build: "TRU_CLEAN",
};

runtime = runtime.replace(/^\s*\/\/ __TRIPWIRE_INJECT__.*$/m, tripwire);
runtime = runtime.replace("const BRAIN   = __BRAIN__;", "const BRAIN   = __TRU_BRAIN_STREAM__;");
runtime = runtime.replace("const KJV     = __KJV__;", `const KJV     = ${scriptJson(kjv)};`);
runtime = runtime.replace("const SESSION = __SESSION__ || {};", `const SESSION = ${scriptJson(state)} || {};`);
runtime = runtime.replace("const META    = __META__ || {};", `const META    = ${scriptJson(meta)} || {};`);
runtime = runtime.replace("const BAKED_MEMORY = __MEMORY__ || { entries: [], version: 0 };", `const BAKED_MEMORY = ${scriptJson(memory)} || { entries: [], version: 0 };`);
runtime = runtime.replace("__PRIMARIES__", scriptJson(primariesLock));
runtime = runtime.replace("__GREEK__", "null");
runtime = runtime.replace("__TRANSLATION__", "null");

if (!runtime.includes("__TRU_BRAIN_STREAM__")) throw new Error("brain marker missing");
if (!shell.includes("/* __TRU_GHOST_RUNTIME__ */")) throw new Error("shell marker missing");

const shellParts = shell.split("/* __TRU_GHOST_RUNTIME__ */");
const runtimeParts = runtime.split("__TRU_BRAIN_STREAM__");
if (shellParts.length !== 2 || runtimeParts.length !== 2) throw new Error("assembly marker count invalid");

mkdirSync(GHOST_DIR, { recursive: true });
try {
  const output = createWriteStream(tempPath, { encoding: "utf8" });
  await writeChunk(output, shellParts[0]);
  await writeChunk(output, runtimeParts[0]);
  await streamJson(brainPath, output);
  await writeChunk(output, runtimeParts[1]);
  await writeChunk(output, shellParts[1]);
  await new Promise<void>((resolve, reject) => {
    output.once("error", reject);
    output.end(resolve);
  });
  renameSync(tempPath, outputPath);
  const bytes = statSync(outputPath).size;
  console.log(JSON.stringify({ ok: true, outputPath, bytes, megabytes: Number((bytes / 1048576).toFixed(2)), brain: brainCount, kjv: meta.kjv, baked, sourceBytes: brainBytes }, null, 2));
} catch (error) {
  try { unlinkSync(tempPath); } catch {}
  throw error;
}
