#!/usr/bin/env python3
"""
TRU/coil_loop_hook.py
---------------------
Tie-in shim called by LOGOS-ENGINE's daily drift loop.

After TRU/build_daily_bundle.py writes <bundle>.html, this hook:
  1. Discovers the newest bundle in the LOGOS working directory
  2. Calls the COIL v2 packer (coil_daily_pack.py) to chunk it
  3. Writes a summary line to stdout that the drift loop captures in its
     commit message, so a single daily commit also publishes chunked
     distribution

This file lives in logos-engine/TRU/ and is invoked by the daily loop.
The packer code is duplicated into logos-engine (TRU/coil_daily_pack.py)
so the loop is self-contained when working offline.

Two helper functions are exported for build_daily_bundle.py:
    pack_daily_bundle(bundle_path, chunk_size=1MiB) -> dict | None
    run_post_bundle_hook(bundle_path, pack=None) -> str
"""
import argparse
import glob
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import coil_daily_pack  # noqa: E402

# Public helpers used by build_daily_bundle.py
def pack_daily_bundle(bundle_path: str, chunk_size: int = 1 * 1024 * 1024) -> dict | None:
    if not bundle_path or not os.path.isfile(bundle_path):
        return None
    out_dir = os.path.join(os.path.dirname(os.path.abspath(bundle_path)) or ".", "coil_pack")
    try:
        manifest, manifest_path = coil_daily_pack.pack_bundle(bundle_path, chunk_size, out_dir)
        return {"manifest": manifest, "manifestPath": manifest_path}
    except Exception as e:
        sys.stderr.write(f"pack_daily_bundle failed: {e}\n")
        return None

def run_post_bundle_hook(bundle_path: str, pack: dict | None = None) -> str:
    if not pack:
        return f"no-pack bundle={os.path.basename(bundle_path) if bundle_path else 'none'}"
    manifest = pack.get("manifest") or {}
    return (
        f"coil-pack bundle={os.path.basename(bundle_path)} "
        f"chunks={len(manifest.get('chunks', []))} "
        f"sha256={manifest.get('sha256', '')[:16]} "
        f"manifest={pack.get('manifestPath', '?')}"
    )

# CLI mode (manual invocation)
def _newest_bundle(bundles_dir: str) -> str | None:
    pattern = os.path.join(bundles_dir, "*.html")
    candidates = [p for p in glob.glob(pattern)
                  if "TRU_DAILY" in os.path.basename(p) or "bundle" in os.path.basename(p).lower()]
    if not candidates:
        candidates = glob.glob(pattern)
    if not candidates:
        return None
    return max(candidates, key=os.path.getmtime)

def _main():
    ap = argparse.ArgumentParser(description="LOGOS-ENGINE → COIL v2 tie-in shim")
    ap.add_argument("--bundles-dir", default=".", help="Where the daily bundle HTML lives")
    ap.add_argument("--chunk-size", type=int, default=1 * 1024 * 1024)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    bundle = _newest_bundle(args.bundles_dir)
    if not bundle:
        print(f"coil_loop_hook: no bundle found under {args.bundles_dir}")
        return  # not fatal

    pack = pack_daily_bundle(bundle, args.chunk_size)
    if not pack:
        sys.stderr.write("coil_loop_hook: packer failed; loop proceeds without COIL chunks\n")
        return  # not fatal

    if not args.quiet:
        print(run_post_bundle_hook(bundle, pack))

if __name__ == "__main__":
    _main()
