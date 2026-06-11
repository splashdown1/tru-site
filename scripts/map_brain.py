#!/usr/bin/env python3
"""
map_brain.py — extract brain data from the TRU_HOLO (12) monolith and
merge the bible-gen subset from TRU_brain.json into a single SQLite
database at /home/workspace/tru/state/tru_brain.db.

Idempotent. Re-runnable. Dry-runnable.

Usage:
  python3 map_brain.py                       # full ingest
  python3 map_brain.py --dry-run --limit 100 # see behaviour on a sample
  python3 map_brain.py --db /tmp/other.sqlite
  python3 map_brain.py --html /path/x.html --brain-json /path/y.json
"""
from __future__ import annotations
import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from brain_lib import init_db, log, summary
from brain_sources import extract_from_html, extract_from_brain_json

DEFAULT_DB   = Path("/home/workspace/tru/state/tru_brain.db")
DEFAULT_HTML = Path("/home/workspace/_archive/tru_versions/TRU_HOLO (12).html")
DEFAULT_JSON = Path("/home/workspace/_archive/tru_versions/TRU_brain.json")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db",         type=Path, default=DEFAULT_DB,   help="SQLite output path (default: %(default)s)")
    p.add_argument("--html",       type=Path, default=DEFAULT_HTML, help="Source HTML monolith")
    p.add_argument("--brain-json", type=Path, default=DEFAULT_JSON, help="Flat bible-gen JSON subset")
    p.add_argument("--limit",      type=int,  default=0,             help="Cap per source per shape (0=unbounded)")
    p.add_argument("--dry-run",    action="store_true",             help="Write to a temp DB; do not touch the real path")
    p.add_argument("--json",       action="store_true",             help="Emit machine-readable JSON instead of text")
    args = p.parse_args(argv)

    if args.dry_run:
        db = Path("/tmp/_brain_dry.sqlite")
        if db.exists():
            db.unlink()
    else:
        db = args.db

    if not db.parent.exists():
        db.parent.mkdir(parents=True, exist_ok=True)

    conn = init_db(db)

    reports: dict = {}
    fail = False

    if args.html and args.html.exists():
        try:
            reports["html"] = extract_from_html(args.html, conn, limit=args.limit)
        except Exception as e:
            reports["html"] = {"error": f"{type(e).__name__}: {e}"}
            log(conn, args.html.name, "error", None, str(e))
            fail = True
    else:
        reports["html"] = {"skipped": "file not found"}

    if args.brain_json and args.brain_json.exists():
        try:
            reports["json"] = extract_from_brain_json(args.brain_json, conn, limit=args.limit)
        except Exception as e:
            reports["json"] = {"error": f"{type(e).__name__}: {e}"}
            log(conn, args.brain_json.name, "error", None, str(e))
            fail = True
    else:
        reports["json"] = {"skipped": "file not found"}

    conn.commit()
    sumr = summary(conn)
    conn.close()

    payload = {
        "db": str(db),
        "dry_run": args.dry_run,
        "completed": datetime.utcnow().isoformat() + "Z",
        "sources": reports,
        "summary": {
            "total": sumr["total"],
            "by_source": sumr["by_source"],
            "by_type":   sumr["by_type"],
        },
        "status": "fail" if fail else "ok",
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))
    else:
        print("=" * 70)
        print("INGEST REPORT")
        print("=" * 70)
        for name, rep in reports.items():
            if name == "html":
                print(f"  {name}:{args.html.name}")
            else:
                print(f"  {name}:{args.brain_json.name}")
            if not rep:
                print("    (no report)")
                continue
            for k, v in rep.items():
                if isinstance(v, list):
                    print(f"    {k:11} {len(v)}")
                else:
                    print(f"    {k:11} {v}")
            print()
        print(f"  DB total nodes: {sumr['total']}")
        print(f"  by source:")
        for s, c in sumr["by_source"]:
            if s is not None: print(f"    {s:30} {c}")
        print(f"  by type:")
        for t, c in sumr["by_type"]:
            print(f"    {t:30} {c}")
        print()
        print(f"  DB path: {db}")
        print(f"  status: {payload['status']}")
        print(f"  completed: {payload['completed']}")
        print("=" * 70)

    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
