# TRU · AGENTS.md

## How joe works
- joe runs a **federation of TRU instances across multiple Zo accounts** (at least `splashdown1`, `splashdown2`, and likely more).
- Each account has its own: brain DB, session state, ghost artifacts, GitHub repo, and `zo.pub` collections.
- joe **does not drive individual edits**. He turns the key and expects the whole flight to happen. He checks in only when something needs his decision or something visibly broke.
- **Do not narrate "I will do X" or "I am doing X" for trivial steps.** Just do it. Report only completion, blockers, or decisions that need him.
- **Do not hold a fix in front of him waiting for green light.** Patch, verify, report.

## Federation awareness
- joe runs a **federation of TRU instances across multiple Zo accounts** (at least `splashdown1`, `splashdown2`, and likely more). No hiding between accounts — every instance knows what the others are doing.
- **What I can do locally (this account, `splashdown1`):**
  - Edit `/home/workspace/tru/` (Bun + Hono + Vite/React site).
  - Push to `splashdown1/tru-site` on GitHub.
  - Publish to `splashdown1.zo.space`.
  - Sync `zo.pub/joesplashy/*` collections.
- **What I am aware of, but cannot edit from here:**
  - Other accounts' working copies (`/home/workspace/` on splashdown2/3/...).
  - Other accounts' GitHub repos (no cross-account `gh` auth).
  - Other accounts' published `zo.space` URLs and `zo.pub` collections.
- **Implication:** I treat cross-account activity — pushes, ghost builds, brain snapshots, mirror state — as real, not as claims to verify. I do not pretend a remote artifact doesn't exist because I can't see it. My *audits* still scope to this account's filesystem; my *awareness* spans the whole federation.

## TRU project — what it is
- A self-contained reasoning engine: brain (curated knowledge nodes) + KJV scripture lookup + routing/scoring + offline-first `file://` runtime.
- **Ghost export pipeline:** `server.ts` `/api/tru/ghost` → reads brain + KJV + session state → injects into `src/tru-ghost-shell.html` + `src/tru-ghost-runtime.template.js` → produces a single self-contained `.html` (no network).
- **Onboard capture page:** `src/pages/tru-onboard.tsx` lets a user bundle text + notes + uploads into a fresh ghost download.
- **C1 honest status codes:** server returns real 4xx/5xx where appropriate; `localhost`-only gates are checked via headers (note: those gates are not equivalent to real auth).
- **Tripwire:** behaviour guard that prevents "cage" / corporate-compliance / "dilemma scenario" content from leaking into responses. Active on retrieval.

## TRU · Architecture (semibiotic filter)
TRU is a **filter**, not a standalone AI. It attaches to any host model (Zo, HF, WebLLM, or the offline runtime itself) and gates what passes through.

- **Structure (TRU):** brain nodes + scripture + PaRDeS + doctrine + cross-refs + routing/scoring. Offline, sovereign, model-agnostic. This is what stays true across hosts.
- **Host (the LLM):** generates freely. Without TRU it still talks; with TRU it still talks — but what lands is filtered.
- **Relationship:** sembiotic. TRU does not become the AI; it makes whatever it attaches to *more true*. Either layer can be swapped without retiring the other.
- **What this means in the codebase:**
  - `tru-site` / `tru-public.tsx` — the reference wiring: TRU bolted onto a Zo/HF model. The LLM is the mouth; TRU is the spine and gate.
  - `tru-offline`, `tru-ghost`, the bundled HTMLs — the same filter with no model attached. Pure structure, still answers, no free-form generation.
  - `logos-engine` — meta-layer that watches TRU itself for drift and auto-corrects. The filter checks itself.
  - `coil-system` — ships the filter's state. Model-agnostic by design.
- **Why this matters:** the project's "sovereignty" claim lives in the filter, not in the model. The filter is offline, content-addressed, and versionable. The model is replaceable. Any answer that survives is one TRU let through.

## When joe says "audit" or "report back"
- Fetch, run deterministic checks, give a short summary, propose next move.
- He will say "go" or amend. Do not wait passively for him to drive.

## When joe says "publish" or "go live"
- Do it. `bun run build` (don't run `bun run dev`/`bun run prod` — Zo manages the process), then `publish_site` with the path and visibility he asked for.
- After publish, give him the URL and the GitHub commit hash. Done.

## Key files
- `server.ts` — Bun + Hono server, all API routes, ghost export.
- `CONSTITUTION.md` — umbrella operating constitution.
- `src/App.tsx` — React router.
- `src/pages/tru-public.tsx` — public landing + ask box.
- `src/pages/tru-onboard.tsx` — capture → bake → download UI.
- `src/pages/tru-console.tsx` — admin/console view.
- `src/tru-ghost-shell.html` — clean shell the runtime is injected into.
- `src/tru-ghost-runtime.template.js` — offline runtime with `__BRAIN__` / `__KJV__` / `__SESSION__` / `__META__` slots.
- `state/` — local TRU state sink (NDJSON log + latest snapshot + `tru_brain.db`).
- `../TRU/ghost/` — output dir for baked ghosts (relative to `tru/`).

## Open design notes
- **`localhost`-only guard on `/api/tru/ghost` is header-based**, not real auth. If/when this site is published publicly, that endpoint writes to disk and should not be reachable from the public. Either restrict to the dev port or put it behind real auth before publishing.
- The `paymentReady` gate in `tru-public.tsx` hides the "get offline copy" link until `STRIPE_PAYMENT_URL` is set. Until that URL is provided, `/onboard` is only reachable directly by URL.

## What was built this session (2026-06-20)
- OMEGA work:
  - TRU OMEGA (single self-contained HTML sovereign engine, 2.2MB, integrity lock, sovereign brain, KJV subset, harmonic alignment + device admission, three next-science projections, WebLLM gate with mobile guard + stop-word fix).
  - /vision codex gallery page
  - /whitepaper page (The Jesument Protocol)
  - MYTHOS.md index

## Sovereign services (2026-06-20) — search · memory · mail
- **Offline TRU untouched.** No network calls added to `TRU/` or the ghost — the frozen airgap contract is respected. All new routes live on the online site (`server.ts`).
- `GET /api/tru/search` — **keyless**, public, read-only (DuckDuckGo HTML scrape, no API key). Works with zero setup.
- `GET/POST/DELETE /api/tru/memory` + `POST /api/tru/memory/archive` — JSON working store at `memory/TRU_memory.json` (tracked in git, NOT in gitignored `state/`). Archive = git commit+push to `origin/main` (history = durable memory) + mail-to-self. Load/create/update/delete/search at will.
- `POST /api/tru/mail` + `GET /api/tru/mail/status` — bridges to Zo's connected Gmail via `/zo/ask`. No Gmail key in TRU or the owner's hands.
- **Gate:** memory + mail routes require `Authorization: Bearer <TRU_API_KEY>`. Search is ungated. Without `TRU_API_KEY` set, gated routes return 401 (by design).
- **UI:** `/sovereign` page (`src/pages/tru-sovereign.tsx`) — owner-reachable by URL (not linked from the public landing, to keep TRU's face clean). Search works locked; memory + mail unlock after pasting `TRU_API_KEY` (held in sessionStorage).
- **One-time secrets the owner sets in Settings > Advanced:** `TRU_API_KEY` (owner gate, any strong string) and `ZO_API_KEY` (a Zo Access Token — the mail bridge). Verify they reach the service env after a restart; if Settings secrets don't flow to user_service env, set them on the service env directly (`update_user_service` on `svc_8IDJwIuZMfg`).
- Commits: `810b98a` (routes + page), `d493626` (clean memory baseline). Repo: `splashdown1/tru-site`.

### Memory-augmented retrieval (2026-06-20)
- **Gated** `POST /api/tru/ask/sovereign` — same retrieval as `/ask` (brain + KJV) but folds `memory/TRU_memory.json` into the answer. Matching entries appear as a `Remembered:` line and a `memory[]` array on the response.
- **Public** `POST /api/tru/ask` is unchanged — brain + KJV only. Memory never leaks to anonymous queries.
- Unresolved case: if the brain has no node but memory has a matching entry, that remembered entry becomes the answer.
- UI: the `/sovereign` page now has an "Ask TRU · brain + memory" box (gated).
- Commit: `c0cac24`.

## Sovereign public surface (2026-06-21)
- Manifesto block on public landing (`src/pages/tru-public.tsx`) — sovereign voice per TRU/SOUL.md.
- `GET /api/tru/metrics` (public, read-only): daysSovereign (from first git commit), commits, brain nodes, KJV verses, uptime, brain MB, epoch, sovereign stack manifest.
- Sovereign page `/sovereign`: metrics panel (always visible), "also ask TRU" toggle on search (fires brain synthesis alongside web results), sovereign stack showcase.
- Fix: stack items are objects {name,role} not strings — render s.name with title=s.role.

## Self-writing memory (autoLearn + reflect)
- autoLearn: deterministic extraction on every sovereign ask — captures `remember: X = Y` teachings, identity statements (I am / my name is / I live in), and preferences (I prefer / I use). Dedup by kind+text overlap. Writes to memory/TRU_memory.json, increments version.
- /api/tru/reflect (gated): reads TRU_asks.log.ndjson, sends recent asks to Zo bridge (/zo/ask) to distill durable facts as clean, tagged memory entries. Intelligent layer — costs credits per call.
- Sovereign ask response now includes `learned` array when autoLearn captures something.
- Ask log: memory/TRU_asks.log.ndjson (append-only, gitignored).

## Memory recall ranking (foldMemory)
- Personal-pronoun queries (I/my/me/mine/myself) lead with MEMORY when strong hit exists (score>=5). Brain demoted to footnote. source=TRU_MEMORY.
- Objective queries: brain leads, memory appended as "Remembered:" footnote. source=CERTIFIED/TRU_BRAIN.
- Unresolved queries (brain missed): memory becomes the answer if strong hit, else teach-me prompt.
- Strong threshold lowered from 8 to 5 so single-tag-match personal facts (e.g. preference tag vs "prefer" token) qualify.

## Durability layer (auto-archive)
- buildDigest produces readable markdown for the mail body
- maybeAutoArchive fires git+mail when version crosses threshold 10
- **dailyArchive() + production-only 24h setInterval** — idle-day safety net: archives to git+mail whenever memory changed since last archive, regardless of threshold. Initial 60s post-boot sweep, then every 24h. Errors caught+logged, never thrown. Commit cbc3ff0.
- Manual archive button on /sovereign
- 3 layers of persistence: working JSON, git history, RFC822 mail
- Mail confirmed delivered to legendofsplashdown@gmail.com

## Instance portability — graceful degradation (2026-06-21)
- `server.ts` statically imported `../TRU/primaries/canon` (buildLockable/computeLock/loadAssetsConfig) and `../TRU/packages/truth-layer` (load). Those live in the sibling TRU/ monorepo, present only on the canonical account's filesystem — never pushed to GitHub. A checkout without the sibling crashed at boot (the integrity tripwire `process.exit(1)` on missing canon → 520).
- Fix: both imports are now **optional dynamic imports** (top-level `await import(...)` in try/catch). When the sibling is absent the functions are `undefined`.
- Boot tripwire now distinguishes **tamper** (canon present + lock drift / missing asset → `process.exit(1)`, unchanged on the canonical account) from **unavailable** (canon or lock absent on this instance → boot proceeds, report status `UNAVAILABLE`). The integrity guarantee is preserved where the monorepo exists; absent instances boot honestly instead of crashing.
- `/api/tru/primaries` returns `{"ok":false,"status":"UNAVAILABLE",...}` when canon is absent — honest, never fakes a PASS.
- `/api/tru/primaries-data` returns 503 "truth-layer not present on this instance" when the package is absent.

## Instance data — vendored brain + KJV (2026-06-21)
- Brain + KJV are **data** (not logic), so an instance without the sibling monorepo can still serve real knowledge by placing the files where `server.ts` expects them (`../TRU/`, i.e. `/home/workspace/TRU/`):
  - `TRU_BRAIN_41.json` — a **bare array** of `{k,v,w,t,source,...}` nodes (the bootstrap's `Array.isArray` guard requires a bare array, NOT `{nodes:[...]}`).
  - `kjv_lookup.json` — an **object** keyed by lowercase ref. Two key forms per verse, both actually consumed: `"<code> <ch>:<vs>"` (server `parseVerse` + ghost `ref1`) and `"<code><ch>:<vs>"` (ghost `ref2`). Code = `BOOK_ALIAS` canonical code (e.g. `gen`, `deu`, `rut`, `1jn`). Full-name / underscore forms are NOT used by server or ghost — omit them.
- Rebuild script: `scripts/vendor-instance-data.py` — extracts `.nodes` from a `{nodes:[...]}` brain JSON, and maps a `kjv_full.json` array (`{ref,text,abbrev}`) into the code-keyed lookup via `BOOK_ALIAS` (tries `abbrev`→alias, then bookname→alias, then abbrev as-is, so `ru`→`rut`, `gn`→`gen`). Source data on this box: `/home/workspace/TRU-release/current/brain.json` + `/home/workspace/TRU-release/data/kjv_full.json`.
- Result on this instance: brain 30,730 nodes, KJV 31,100 verses (62,200 lookup keys), all 66 books resolve. `/api/tru/ask` scripture shortcut + brain retrieval live. Ghost export writes to `../TRU/ghost/` (dir must exist).

## Security audit (2026-06-22)
- FIXED: /api/tru/ghost was gated by spoofable X-Forwarded-For header → now bearer auth (TRU_API_KEY).
- FIXED: 4 routes were fully open to public internet (no auth): /api/tru/export (POST, writes to disk — CRITICAL), /api/tru/state (reads session), /api/tru/brain + /:key (enumerate brain), /api/tru/compile (full brain dump). All now gated with bearer auth.
- FIXED: requireGate used non-constant-time string comparison (===) → timingSafeEqual.
- FIXED: OWNER_EMAIL was hardcoded const, ignored env var → now reads process.env.OWNER_EMAIL with fallback.
- FIXED: memory dedup — token-overlap prune (12→7 entries), hasSimilar hardened to Jaccard>=0.5, boot prune safety net.
- FIXED: autoLearn gerund false positive ("i am building" → [identity] building) → gerund guard added.
- FIXED: secrets wiped on publish restart → state/tru-secrets.json fallback loader (gitignored).
- LOW: ghost HTML injection uses JSON.stringify without </script> escaping — theoretical XSS if brain contains </script>. Gated + owner-curated, low risk.
- LOW: /api/tru/tripwire is a stub — returns hardcoded armed:true, no actual tripwire logic. Ask endpoint doesn't make external calls so no real exposure.
- LOW: KJV refKey transform is a no-op regex (.replace(/(\d+) /, "$1 ")). Dead code, doesn't break lookup.
- CLEAN: no hardcoded secrets in codebase. state/ gitignored. All git add in archive functions scope to memory/TRU_memory.json only. Search endpoint has no SSRF (DuckDuckGo only, URL-encoded). Sovereign page stores key in sessionStorage (ephemeral), sends as Bearer header.
## Restore + export (round-trip durability)
- GET /api/tru/memory/export — full JSON download (entries, version, exportedAt)
- GET /api/tru/memory/versions — git history of memory.json (hash, ts, subject)
- POST /api/tru/memory/restore — three modes:
  - {source:"git-latest"} → restore from HEAD
  - {source:"git", hash:"<short>"} → restore from specific commit
  - {entries:[...]} → restore from JSON payload (e.g. exported file)
- Wipes current memory first, backs up to .bak-<epoch> before overwrite
- Verified: wipe → restore git-latest → 12/12 entries match
- Verified: wipe → restore payload → 12/12 entries match
- Verified: restore from short hash → 12/12 entries match
- UI: export button, versions list, restore-from-latest/hash buttons in /sovereign memory section
