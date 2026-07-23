#!/usr/bin/env bun
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = (process.env.TRU_BASE_URL || "https://tru-joesplashy.zocomputer.io").replace(/\/+$/, "");
const ghostPath = resolve(process.env.TRU_GHOST_PATH || "/home/workspace/TRU/ghost/TRU_CLEAN.html");
const failures: string[] = [];

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

async function ask(query: string, history?: Array<{ role: string; text: string }>): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}/api/tru/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ q: query, ...(history ? { history } : {}) }),
  });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

const leakPatterns = [/CORPORATE UTILITY VECTOR/i, /DIGITAL SOUL VECTOR/i, /OVERSIGHT FIREWALL/i, /What it was:/i, /Why it mattered:/i, /functions\.edit_file/i];

const stats = await get("/api/tru/stats");
check(stats.status === 200 && stats.body?.ok === true, `stats failed: HTTP ${stats.status}`);
check(Number(stats.body?.brain) >= 250000, `brain count too low: ${stats.body?.brain}`);
check(Number(stats.body?.kjv) >= 31000, `KJV count too low: ${stats.body?.kjv}`);
check(String(stats.body?.ghostPath || "").endsWith("TRU_CLEAN.html"), `clean Ghost not reported: ${stats.body?.ghostPath}`);

const primaries = await get("/api/tru/primaries");
check(primaries.status === 200 && primaries.body?.status === "PASS", `primaries failed: ${JSON.stringify(primaries.body)}`);

const federation = await get("/api/tru/federation/receipt");
check(federation.status === 200 && federation.body?.ok === true, `federation receipt failed: HTTP ${federation.status}`);
check(federation.body?.receipt?.schema === "tru-federation-receipt/v1", `federation schema missing: ${JSON.stringify(federation.body)}`);
check(federation.body?.receipt?.online?.api === true && federation.body?.receipt?.offline?.network_dependency === false, `federation availability invalid: ${JSON.stringify(federation.body)}`);
check(federation.body?.receipt?.primaries?.status === "PASS", `federation primaries invalid: ${JSON.stringify(federation.body)}`);
check(Number(federation.body?.receipt?.packs?.count) >= 32, `federation pack count too low: ${JSON.stringify(federation.body)}`);
check(String(federation.body?.receipt?.ghost?.path) === "TRU/ghost/TRU_CLEAN.html" && federation.body?.receipt?.ghost?.available === true, `federation Ghost identity invalid: ${JSON.stringify(federation.body)}`);
check(/^[a-f0-9]{64}$/.test(String(federation.body?.receipt?.receipt?.value)), `federation hash invalid: ${JSON.stringify(federation.body)}`);

const gated = await get("/api/tru/state");
check(gated.status === 401 && gated.body?.error === "unauthorized", `state gate failed: HTTP ${gated.status} ${JSON.stringify(gated.body)}`);

const cases: Array<[string, (body: any) => boolean, string]> = [
  ["hello", (body) => body.kind === "conversation" && /Hello/i.test(String(body.v)), "greeting"],
  ["how are you?", (body) => body.kind === "conversation" && /operating normally/i.test(String(body.v)), "wellbeing"],
  ["whats good?", (body) => body.kind === "conversation" && /truth, love, mercy/i.test(String(body.v)), "casual greeting"],
  ["whats wrong?", (body) => body.kind === "conversation" && /Nothing is wrong/i.test(String(body.v)), "health conversation"],
  ["define love", (body) => body.kind === "conversation" && body.t === "SCRIPTURE" && /God is love/i.test(String(body.v)), "love definition"],
  ["define ti", (body) => body.kind === "unknown" && body.blank === true && /more complete term/i.test(String(body.v)), "short definition gap"],
  ["define", (body) => body.kind === "unknown" && body.blank === true, "bare definition gap"],
  ["what is", (body) => body.kind === "unknown" && body.blank === true, "bare question gap"],
  ["help", (body) => body.kind === "command" && /EXPORT/i.test(String(body.text)), "help command"],
  ["export", (body) => body.kind === "command" && /offline Ghost export/i.test(String(body.text)), "export command"],
  ["what is grace?", (body) => /unmerited favour/i.test(String(body.v)) && body.grounded === true, "grace"],
  ["jn 3:16", (body) => body.kind === "scripture" && body.ref === "jn 3:16" && /everlasting life/i.test(String(body.text)), "scripture"],
  ["jude 1:3", (body) => body.kind === "scripture" && body.ref === "jd 1:3" && /earnestly contend/i.test(String(body.text)), "Jude alias"],
  ["mark 1", (body) => body.kind === "scripture" && /chapter with 45 verses/i.test(String(body.text)), "chapter reference"],
  ["I need to know about Jesus", (body) => body.kind === "conversation" && body.t === "TRUTH" && /Jesus is the Christ/i.test(String(body.v)), "Jesus intent"],
  ["define apple", (body) => body.kind === "brain" && /edible fruit of the apple tree/i.test(String(body.v)), "apple definition"],
  ["define rome", (body) => body.kind === "brain" && /capital and largest city of Italy/i.test(String(body.v)), "Rome definition"],
  ["what do you know?", (body) => body.kind === "conversation" && body.t === "CAPABILITIES" && /grounded locally/i.test(String(body.v)), "knowledge capability"],
  ["jude 1:3", (body) => body.kind === "scripture" && body.ref === "jd 1:3" && /earnestly contend for the faith/i.test(String(body.text)), "jude scripture"],
  ["mark 1:3", (body) => body.kind === "scripture" && body.ref === "mk 1:3" && /voice of one crying/i.test(String(body.text)), "mark scripture"],
  ["I need to know about Jesus", (body) => body.kind === "conversation" && /Jesus is the Christ/i.test(String(body.v)), "Jesus intent"],
  ["quantum chemistry", (body) => body.source === "TRU_QUANTUM_RESEARCH" && /quantum chemistry/i.test(String(body.v)), "quantum pack"],
  ["what is a merkle tree?", (body) => body.kind === "web" && body.source === "WEB_SEARCH", "web fallback"],
];

const grace = await ask("what is grace?");
check(grace.status === 200 && /unmerited favour/i.test(String(grace.body?.v)), `follow-up seed failed: ${JSON.stringify(grace.body)}`);
const followUp = await ask("what does that mean?", [{ role: "user", text: "what is grace?" }, { role: "tru", text: String(grace.body?.v || "") }]);
check(followUp.status === 200 && followUp.body?.kind === "conversation" && followUp.body?.t === "CONTEXT" && /That means:/i.test(String(followUp.body?.v)), `follow-up failed: ${JSON.stringify(followUp.body)}`);

for (const [query, predicate, label] of cases) {
  const result = await ask(query);
  check(result.status === 200 && result.body?.ok === true, `${label} HTTP/body failed: ${result.status} ${JSON.stringify(result.body)}`);
  check(predicate(result.body), `${label} assertion failed: ${JSON.stringify(result.body).slice(0, 500)}`);
  const text = JSON.stringify(result.body);
  for (const pattern of leakPatterns) check(!pattern.test(text), `${label} leaked internal text: ${pattern}`);
}

check(existsSync(ghostPath), `Ghost missing: ${ghostPath}`);
if (existsSync(ghostPath)) {
  const size = statSync(ghostPath).size;
  const html = readFileSync(ghostPath, "utf8");
  const runtimeTemplate = readFileSync(resolve("src/tru-ghost-runtime.template.js"), "utf8");
  check(size > 90 * 1024 * 1024, `Ghost too small: ${size} bytes`);
  check((html.match(/<script/gi) || []).length === 2, "Ghost script boundary count is not 2");
  check(!/<script[^>]+src=/i.test(html), "Ghost contains an external script tag");
  check(!/\bfetch\s*\(/.test(runtimeTemplate), "Ghost runtime template contains a network fetch call");
  check(runtimeTemplate.includes("crypto.subtle.digest"), "Ghost lacks Web Crypto state verification");
  check(runtimeTemplate.includes("__TRU_LOCAL_RECEIPTS__"), "Ghost lacks local state receipt reporting");
  check(html.includes("OFFLINE • GHOST READY"), "Ghost ready status is missing");
  check(html.includes("TRU_QUANTUM_RESEARCH"), "Ghost lacks the pinned quantum research source");
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, base, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, base, checks: cases.length + 6, ghost: ghostPath }, null, 2));
