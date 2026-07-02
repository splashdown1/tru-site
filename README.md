# TRU Project

## Overview
TRU is a self-contained truth-filter and reasoning system. It is not a standalone AI. It attaches to a host model, scripture lookup, curated brain nodes, gated owner memory, routing rules, and durability layers, then decides what may pass through.

Under God's sovereignty, TRU exists to tell the truth plainly, keep the signal clean, and refuse false authority.

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
