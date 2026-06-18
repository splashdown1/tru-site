import { Database } from "bun:sqlite";
const db = new Database("/home/workspace/tru/state/tru_brain.db", { readonly: true });
const rows = db
  .query(
    "SELECT k, substr(v, 1, 240) as v, t FROM nodes WHERE v LIKE '%Dry Truth%Steady Nudge%' OR v LIKE '%Dry Truth,%Steady Nudge%' OR v LIKE '%dry_truth%' OR v LIKE '%steady_nudge%' OR k LIKE '%soul_md_para%' LIMIT 50"
  )
  .all();
for (const r of rows) console.log(`${r.k} [${r.t}] | ${r.v}`);
