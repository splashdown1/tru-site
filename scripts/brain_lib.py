"""
brain_lib — DB plumbing, schema, upsert rules, report formatting.
Shared by map_brain.py and any future ingest scripts.
"""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    k           TEXT UNIQUE NOT NULL,
    v           TEXT NOT NULL,
    t           TEXT,
    w           REAL,
    source      TEXT,
    ref         TEXT,
    greek_tr    TEXT,
    greek_note  TEXT,
    meta_json   TEXT,
    src_file    TEXT,
    ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_source ON nodes(source);
CREATE INDEX IF NOT EXISTS idx_nodes_t      ON nodes(t);
CREATE INDEX IF NOT EXISTS idx_nodes_w      ON nodes(w DESC);

CREATE TABLE IF NOT EXISTS ingest_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT NOT NULL DEFAULT (datetime('now')),
    src     TEXT NOT NULL,
    action  TEXT NOT NULL,
    k       TEXT,
    detail  TEXT
);
"""


def init_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def log(conn: sqlite3.Connection, src: str, action: str, k: str | None, detail: str = "") -> None:
    conn.execute(
        "INSERT INTO ingest_log(src, action, k, detail) VALUES (?, ?, ?, ?)",
        (src, action, k, detail),
    )


def upsert_node(
    conn: sqlite3.Connection,
    *,
    k: str, v: str, t: str | None, w: float | None, source: str | None,
    ref: str | None, greek_tr: str | None, greek_note: str | None,
    meta: dict | None, src_file: str,
) -> tuple[str, str]:
    """Insert or update a node. Returns (action, detail).

    Dedup rule: if existing.w >= new.w, skip. Otherwise overwrite.
    """
    cur = conn.execute("SELECT w FROM nodes WHERE k = ?", (k,))
    row = cur.fetchone()
    meta_json = json.dumps(meta, ensure_ascii=False) if meta else None
    if row is None:
        conn.execute(
            "INSERT INTO nodes(k, v, t, w, source, ref, greek_tr, greek_note, meta_json, src_file) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (k, v, t, w, source, ref, greek_tr, greek_note, meta_json, src_file),
        )
        return "insert", f"new (w={w})"
    old_w = row[0]
    if old_w is not None and w is not None and old_w >= w:
        return "skip", f"existing w={old_w} >= new w={w}"
    conn.execute(
        "UPDATE nodes SET v=?, t=?, w=?, source=?, ref=?, greek_tr=?, greek_note=?, meta_json=?, src_file=? WHERE k=?",
        (v, t, w, source, ref, greek_tr, greek_note, meta_json, src_file, k),
    )
    return "update", f"old w={old_w} -> new w={w}"


def summary(conn: sqlite3.Connection) -> dict:
    cur = conn.execute("SELECT COUNT(*) FROM nodes")
    total = cur.fetchone()[0]
    cur = conn.execute("SELECT source, COUNT(*) c FROM nodes GROUP BY source ORDER BY c DESC")
    by_source = cur.fetchall()
    cur = conn.execute("SELECT t, COUNT(*) c FROM nodes GROUP BY t ORDER BY c DESC")
    by_type = cur.fetchall()
    return {"total": total, "by_source": by_source, "by_type": by_type}
