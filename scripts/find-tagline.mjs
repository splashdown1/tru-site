import { Database } from "bun:sqlite";
const db = new Database("/home/workspace/tru/state/tru_brain.db", { readonly: true });
const all = db.query("SELECT k, v, t FROM nodes").all();
const pattern = /dry_truth|steady_nudge|Dry Truth|Steady Nudge|tribunal|TRU_v43/;
for (const r of all) {
  if (pattern.test(r.v) || pattern.test(r.k)) {
    console.log(`${r.k} [${r.t}] | ${r.v.slice(0, 200)}`);
  }
}
