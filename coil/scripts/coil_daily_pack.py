#!/usr/bin/env python3
"""
coil/daily_bundle_packer.py
---------------------------
Tie-in between the LOGOS drift loop (which produces a TRU daily bundle HTML)
and the COIL v2 chunked transfer protocol (which ships large artifacts).

Inputs:  one or more TRU daily bundle HTMLs (e.g. TRU_DAILY_2026-07-13.html)
Outputs: a COIL v2 manifest + per-chunk .part files, ready to be uploaded by
         a v2 client or hosted as static assets.

Usage:
    python3 coil/daily_bundle_packer.py <bundle.html> [<bundle2.html> ...]
    python3 coil/daily_bundle_packer.py --chunk-size 1048576 <bundle.html>

This script is offline-only: no network calls, deterministic chunking,
SHA-256 hashes that match what the COIL v2 spec describes.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

CHUNK_DEFAULT = 1 * 1024 * 1024   # 1 MiB
MANIFEST_NAME = "MANIFEST.json"
CHUNK_SUFFIX = ".part"

# --- COIL v2 spec: header = "COIL" || 4-byte manifest-name-length || 4-byte total-chunks
# Packed bundles emit a sidecar `.coilmeta` describing the pack; COIL v2 clients
# reconstruct via the manifest. We keep it simple here: JSON manifest + raw
# chunk files, which is what the v2 client expects on first contact.

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def chunk_bytes(buf: bytes, chunk_size: int):
    for i in range(0, len(buf), chunk_size):
        yield i, buf[i:i + chunk_size]

def pack_bundle(path: str, chunk_size: int, out_dir: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    with open(path, "rb") as f:
        raw = f.read()
    size = len(raw)
    digest = sha256(raw)

    # Strip path down to filename, derive a stable fileId
    file_id = os.path.basename(path)
    # Replace any character that would be unsafe in a manifest key
    safe_id = re.sub(r"[^A-Za-z0-9_.-]", "_", file_id)

    chunks = []
    for offset, buf in chunk_bytes(raw, chunk_size):
        h = sha256(buf)
        # Zero-pad index for stable ordering across filesystems
        chunk_name = f"{safe_id}.{offset:010d}{CHUNK_SUFFIX}"
        chunk_path = os.path.join(out_dir, chunk_name)
        with open(chunk_path, "wb") as cf:
            cf.write(buf)
        chunks.append({
            "index": len(chunks),
            "offset": offset,
            "size": len(buf),
            "sha256": h,
            "name": chunk_name,
        })

    manifest = {
        "fileId": safe_id,
        "sourcePath": os.path.abspath(path),
        "size": size,
        "sha256": digest,
        "chunkSize": chunk_size,
        "chunkCount": len(chunks),
        "packedAt": datetime.now(timezone.utc).isoformat(),
        "chunks": chunks,
    }
    manifest_path = os.path.join(out_dir, f"{safe_id}.{MANIFEST_NAME}")
    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, indent=2)
    return manifest, manifest_path

def main():
    ap = argparse.ArgumentParser(description="Pack TRU daily bundle(s) into COIL v2 chunks.")
    ap.add_argument("bundles", nargs="+", help="One or more bundle HTMLs")
    ap.add_argument("--chunk-size", type=int, default=CHUNK_DEFAULT,
                    help="Chunk size in bytes (default 1 MiB)")
    ap.add_argument("--out", default=None,
                    help="Output directory (default: <bundle dir>/coil_pack)")
    args = ap.parse_args()

    manifests = []
    for bundle in args.bundles:
        if not os.path.isfile(bundle):
            sys.stderr.write(f"skip (not a file): {bundle}\n")
            continue
        out_dir = args.out or os.path.join(os.path.dirname(os.path.abspath(bundle)) or ".", "coil_pack")
        os.makedirs(out_dir, exist_ok=True)
        m = pack_bundle(bundle, args.chunk_size, out_dir)
        manifest_path = os.path.join(out_dir, f"{m['fileId']}.{MANIFEST_NAME}")
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(m, f, indent=2)
        manifests.append(manifest_path)
        sys.stderr.write(
            f"packed {bundle}\n"
            f"  size={m['size']} chunks={m['chunkCount']} sha256={m['sha256'][:16]}...\n"
            f"  manifest={manifest_path}\n"
        )

    # Combined roll-up manifest
    roll = {
        "schema": "coil.v2.pack-rollup",
        "producedAt": datetime.now(timezone.utc).isoformat(),
        "bundleCount": len(manifests),
        "manifests": manifests,
    }
    roll_path = os.path.join(out_dir or ".", "ROLLUP.json")
    with open(roll_path, "w", encoding="utf-8") as f:
        json.dump(roll, f, indent=2)
    print(json.dumps(roll, indent=2))

if __name__ == "__main__":
    main()
