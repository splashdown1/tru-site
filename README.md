# TRU Project

## Overview
TRU is a self-contained truth-filter and reasoning system. It is not a standalone AI. It attaches to a host model, scripture lookup, curated brain nodes, gated owner memory, routing rules, and durability layers, then decides what may pass through.

Under God's sovereignty, TRU exists to tell the truth plainly, keep the signal clean, and refuse false authority.

## Operating order
- **Offline first, then online.** Prefer the offline ghost, local brain, local scripture, and local reasoning paths before any online surface.
- Use online services only when they are explicitly needed and fit the task.
- All reports, audits, and build notes should carry UTC timestamps so changes are traceable.

## Voice and first contact
TRU should speak for itself. The public voice should be sober, direct, and recognisably TRU — not generic assistant prose, not copied personality, and not robotic filler.

On a fresh session, the first response should be a short greeting and orientation, not a full dump of internals. It should:
- identify itself plainly
- state the truth-first posture
- show the next best commands
- invite the user to begin

Recommended opening:
- `Greetings. I am TRU.`
- `Truth is constant. Perspective is fluid.`
- `I answer from anchored knowledge rather than guess.`
- `Type HELP, INTRO, or STATUS to begin.`

Command surface:
- `HELP` — full command and capability list
- `INTRO` — guided tour of what TRU can do
- `STATUS` — loaded packs, memory state, and health snapshot
- `CAPABILITIES` — quick overview of available surfaces
- `TRIPWIRE` — view live tripwire state (cage / compliance / dilemma patterns + heartbeat)

## Tripwire

TRU runs a single source of truth for refusal patterns: 27 regex patterns across three buckets (`cage`, `compliance`, `dilemma`). When a query matches a pattern, TRU refuses and logs the hit with a heartbeat stamp. The same module is baked into the airgapped ghost runtime at export, so the ghost refuses the same way the server does — no drift.

- `GET /api/tru/tripwire` — per-bucket pattern count, last hit excerpt, last heartbeat
- `src/lib/tripwire.ts` — single source of truth (TypeScript, server-side)
- `src/tru-ghost-tripwire.js` — pure-JS copy baked into the ghost runtime at export

## Current snapshot
As of 2026-07-02, TRU has broadened its reference surface with scripture, Strong’s lexicon, general dictionary coverage, encyclopaedia, cross-references, life knowledge, and additional professional/classical corpora including medical, legal, historical, philosophical, and related dictionaries.

## Canonical guidance

The project's governing documents live in:
- `file '/home/workspace/tru/CONSTITUTION.md'`
- `file '/home/workspace/tru/BLUEPRINTS.md'`
- `file '/home/workspace/tru/SOPS.md'`
- `file '/home/workspace/tru/AGENTS.md'`

The higher-level philosophy lives in:
- `file '/home/workspace/tru/TRU_WHITEPAPER.md'`
- `file '/home/workspace/tru/MYTHOS.md'`

## Data packs
TRU now includes derived knowledge packs for:
- medical dictionary
- law dictionary
- history dictionary
- philosophy dictionary
- Greek philosophy dictionary
- Roman dictionary
- Eastern wisdom dictionary
- literature dictionary
- hermetic dictionary

These packs expand the retrieval surface without changing the offline contract.

## Architecture

### File Structure

```
.
├── server.ts              # Main server (Hono + Vite middleware)
├── index.html             # HTML entry point for React
├── vite.config.ts         # Vite configuration
├── package.json           # Dependencies and scripts
├── zosite.json            # Zo deployment config (ports, env vars)
├── public/                # Static assets
├── backend-lib/
│   └── zo-api.ts          # Helper for calling Zo API
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── styles.css
    └── pages/
```

## Development vs Production

**Development Mode** (`bun run dev`):
- Single Bun process running `server.ts`
- Vite in middleware mode transforms files on-the-fly
- API routes: `/api/*` handled by Hono
- React app: served via Vite transforms
- Client-side routing: any non-API, non-file route falls back to `index.html`
- **Environment**: Site runs at an internal authenticated URL accessible only to you

**Production Mode** (`bun run prod`):
- Builds React app to `dist/` using Vite
- Bun serves static files from `dist/` via `hono/bun` serveStatic
- API routes still handled by Hono
- SPA fallback: all non-API routes serve `dist/index.html`
- **Environment**: Site is published and accessible to anyone on the internet at a public URL

NEVER use the scripts `bun run dev` or `bun run prod`. The Zo system handles running the site in the correct mode based on context. All process management of the server is handled by Zo.

## Key Technologies

This application uses:
- **Bun** as the runtime
- **Hono** as the web framework
- **React + Vite** for the frontend
- **Tailwind CSS 4** for styling
