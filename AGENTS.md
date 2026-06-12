# TRU · AGENTS.md

## How joe works
- joe runs a **federation of TRU instances across multiple Zo accounts** (at least `splashdown1`, `splashdown2`, and likely more).
- Each account has its own: brain DB, session state, ghost artifacts, GitHub repo, and `zo.pub` collections.
- joe **does not drive individual edits**. He turns the key and expects the whole flight to happen. He checks in only when something needs his decision or something visibly broke.
- **Do not narrate "I will do X" or "I am doing X" for trivial steps.** Just do it. Report only completion, blockers, or decisions that need him.
- **Do not hold a fix in front of him waiting for green light.** Patch, verify, report.

## What I (this Zo agent) can see
- `/home/workspace/tru/` — the working copy of the `splashdown1` site (Bun + Hono + Vite/React).
- GitHub: `splashdown1/tru-site` (`origin/main`).
- `splashdown1.zo.space` (the published site for this account).
- `zo.pub/joesplashy/*` — joe's main `zopub` collections under handle `joesplashy`.
- Other account handles' `zo.pub` collections are visible if I list them, but I cannot edit those accounts' sites or repos from here.

## What I cannot see
- Other Zo accounts' working copies (no shared filesystem).
- Other accounts' GitHub repos (no auth).
- Other accounts' published `zo.space` URLs (no auth).

**Implication:** if joe says "I pushed to splashdown2" or "the splashdown3 ghost is live," I have to take his word for it. My "audit" can only ever be local to splashdown1. Do not claim something is or isn't real across accounts.

## TRU project — what it is
- A self-contained reasoning engine: brain (curated knowledge nodes) + KJV scripture lookup + routing/scoring + offline-first `file://` runtime.
- **Ghost export pipeline:** `server.ts` `/api/tru/ghost` → reads brain + KJV + session state → injects into `src/tru-ghost-shell.html` + `src/tru-ghost-runtime.template.js` → produces a single self-contained `.html` (no network).
- **Onboard capture page:** `src/pages/tru-onboard.tsx` lets a user bundle text + notes + uploads into a fresh ghost download.
- **C1 honest status codes:** server returns real 4xx/5xx where appropriate; `localhost`-only gates are checked via headers (note: those gates are not equivalent to real auth).
- **Tripwire:** behaviour guard that prevents "cage" / corporate-compliance / "dilemma scenario" content from leaking into responses. Active on retrieval.

## When joe says "audit" or "report back"
- Fetch, run deterministic checks, give a short summary, propose next move.
- He will say "go" or amend. Do not wait passively for him to drive.

## When joe says "publish" or "go live"
- Do it. `bun run build` (don't run `bun run dev`/`bun run prod` — Zo manages the process), then `publish_site` with the path and visibility he asked for.
- After publish, give him the URL and the GitHub commit hash. Done.

## Key files
- `server.ts` — Bun + Hono server, all API routes, ghost export.
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
