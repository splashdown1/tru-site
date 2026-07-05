# TRU Engine Repo

This repository is the **engine repo** for TRU: the working codebase that powers the public TRU site, the offline ghost export, and the memory workflows around them.

It is not the explanation repo. If you want the deeper conceptual write-up, see `tru-overview`.

## What lives here

- **Public TRU surface** — ask, route, and surface the current engine to users
- **Offline artefact flows** — bake, export, and download self-contained ghosts
- **State and memory** — durable workflow state, exported sessions, and archive paths
- **API routes** — retrieval, ghost export, state, search, and memory operations
- **Owner tooling** — console / sovereign views for diagnostics and restoration

## What TRU is

TRU is a self-contained truth-filter and reasoning system attached to a host model. It combines:

- a curated brain of knowledge nodes
- scripture lookup
- lexical / dictionary routing
- memory capture and recall
- offline ghost baking for downloadable artefacts

It is designed to answer plainly, admit gaps, and preserve durable memory without depending on the cloud.

## Architecture

- **Backend:** Bun + Hono
- **Frontend:** React + Vite
- **Styling:** Tailwind CSS 4
- **Routing:** client-side pages plus API routes
- **Exports:** ghost bake / download flows for offline HTML artefacts

## Current surfaces

- `/` — public TRU landing and ask surface
- `/vision` — codex / gallery
- `/whitepaper` — protocol overview
- `/onboard` — capture → bake → download
- `/console` — owner diagnostics and ghost export controls
- `/sovereign` — memory, search, mail tooling

## Coherence rules

- This README is the public-facing summary for the engine repo.
- Keep the deeper internal explanation in `tru-overview`.
- Do not blur the line between the engine repo and the explanation repo.
- If the public surface changes, update this file first.
