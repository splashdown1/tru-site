# COIL v2 — Chunked Offline-Ingest Layer

This service ingests TRU daily knowledge bundles (HTML) from
`tru-offline/coil/scripts/coil_daily_pack.py` into the live TRU
knowledge-packs subsystem. It is the receive side of the
`tru-offline → tru` sync.

## Endpoints (added to `server.ts`)

| Method | Path                  | Purpose |
| ------ | --------------------- | ------- |
| GET    | `/api/coil/status`    | Show enabled/incoming/ghostOut |
| POST   | `/api/coil/session`   | Open an ingest session |
| POST   | `/api/coil/chunk`     | Receive a chunk + 256-byte sha256 trailer |
| POST   | `/api/coil/finalize`  | Commit MANIFEST + ROLLUP |

## How to use

```bash
# 1. In a shell, run the packer locally (it produces chunks in coil_pack/):
cd /home/workspace/tru-offline
python3 coil/scripts/coil_daily_pack.py path/to/TRU_DAILY.html --out /tmp/tru_daily_pack

# 2. POST the chunks to the live server. The packer is the sender side
#    of the protocol; the server is the receiver. Use the live
#    `coil_send.py` helper:
python3 coil/scripts/coil_send.py /tmp/tru_daily_pack --base https://tru-joesplashy.zocomputer.io
```

The server is open. No API key required for COIL routes (the auth
gate on `/api/tru/ghost` is separate). The chunk stream is sha256
verified; the final manifest is committed into
`/home/workspace/TRU/ghost/<bundle>.MANIFEST.json` and an
append-only `COIL_ROLLUP.ndjson` is updated for audit.

## Auth

If `COIL_API_KEY` is set in the environment, all COIL POST endpoints
require `Authorization: Bearer <key>`. The receiver's `coil_send.py`
will read it from `COIL_API_KEY` and send it automatically.
