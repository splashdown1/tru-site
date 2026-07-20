# COIL — v2.0.0

Chunked, hash-anchored, offline-first knowledge pack format. Each daily
`TRU_*` bundle is chunked into `.part` files (default 1 MiB) and a
per-file `.MANIFEST.json` is written next to the chunks. A rollup
`ROLLUP.json` covers all bundles packed in one run.

## Layout

```
coil/
├── SPEC.md            v2.0.0 protocol spec
├── README.md          this file
├── scripts/
│   ├── coil_daily_pack.py     packer: bundle → chunks + MANIFEST
│   └── coil_loop_hook.py      shim: runs after the daily loop, calls the packer
└── v1-legacy/         v1 reference impl + v1->v2 diff notes (frozen)
```

## Quick start

```bash
# 1) Pack a single bundle (chunks default to 1 MiB)
python3 scripts/coil_daily_pack.py /path/to/TRU_DAILY.html \
    --out /path/to/coil_pack

# 2) Run the drift-loop hook against a directory of bundles
python3 scripts/coil_loop_hook.py --bundles-dir /path/to/bundles

# 3) Decode a packed file (client side)
python3 -c "
import json, hashlib
m = json.load(open('/path/to/coil_pack/X.MANIFEST.json'))
for c in m['chunks']:
    data = open(f'/path/to/coil_pack/{c[\"name\"]}','rb').read()
    assert hashlib.sha256(data).hexdigest() == c['sha256']
print('verified', m['fileId'])
"
```

## Tie-in (logos-engine)

`scripts/coil_loop_hook.py` is invoked at the end of
`logos-engine/TRU/build_daily_bundle.py` so every drift-corrected
bundle is automatically packed into COIL v2 chunks + manifest. See
`SPEC.md` for the hash/chunking/rollup contract.
