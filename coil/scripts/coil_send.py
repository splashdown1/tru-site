#!/usr/bin/env python3
"""Send a COIL v2 pack to a live TRU server.

Walks a pack directory produced by coil_daily_pack.py, opens a session,
streams every chunk with its 256-byte sha256 trailer, then finalises.

Reads COIL_API_KEY from the environment for bearer auth (optional).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import List, Optional

CHUNK_SUFFIX = ".coil.chunk"
MANIFEST_SUFFIX = ".MANIFEST.json"
TRAILER_BYTES = 256


def http_post(url: str, data: bytes, headers: Optional[dict] = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=data, method="POST")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def http_get(url: str) -> tuple[int, bytes]:
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.status, r.read()


def discover(pack_dir: str) -> tuple[Optional[str], List[str]]:
    files = sorted(os.listdir(pack_dir))
    manifest = None
    chunks = []
    for f in files:
        if f.endswith(MANIFEST_SUFFIX):
            manifest = f
        elif f.endswith(CHUNK_SUFFIX):
            chunks.append(f)
    return manifest, chunks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pack_dir")
    ap.add_argument("--base", required=True, help="e.g. https://tru-joesplashy.zocomputer.io")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    auth = os.environ.get("COIL_API_KEY")
    headers = {"Authorization": f"Bearer {auth}"} if auth else {}

    s, body = http_get(f"{base}/api/coil/status")
    print(f"GET status: {s} {body[:120].decode(errors='replace')}")
    if s != 200:
        return 1

    manifest_name, chunks = discover(args.pack_dir)
    if not manifest_name or not chunks:
        print("no manifest or chunks in", args.pack_dir, file=sys.stderr)
        return 1
    with open(os.path.join(args.pack_dir, manifest_name)) as f:
        m = json.load(f)
    session = m["session"]
    bundle = m["bundle"]
    expected_sha = m["sha256"]
    chunk_size = m["chunkSize"]

    s, body = http_post(
        f"{base}/api/coil/session",
        urllib.parse.urlencode({
            "sessionId": session,
            "bundleName": bundle,
            "chunkSize": str(chunk_size),
            "totalChunks": str(len(chunks)),
            "expectedSha256": expected_sha,
        }).encode(),
        {**headers, "Content-Type": "application/x-www-form-urlencoded"},
    )
    print(f"POST session: {s} {body.decode()}")
    if s != 200:
        return 1

    for cf in chunks:
        path = os.path.join(args.pack_dir, cf)
        with open(path, "rb") as f:
            raw = f.read()
        trailer = hashlib.sha256(raw).hexdigest().encode().ljust(TRAILER_BYTES, b" ")
        s, body = http_post(f"{base}/api/coil/chunk", raw + trailer, headers)
        print(f"POST chunk {cf}: {s} {body[:80].decode(errors='replace')}")
        if s != 200:
            return 1

    s, body = http_post(
        f"{base}/api/coil/finalize",
        urllib.parse.urlencode({"sessionId": session}).encode(),
        {**headers, "Content-Type": "application/x-www-form-urlencoded"},
    )
    print(f"POST finalize: {s} {body.decode()}")
    return 0 if s == 200 else 1


if __name__ == "__main__":
    sys.exit(main())
