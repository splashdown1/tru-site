"""
brain_sources — extractors for each input source.
"""
from __future__ import annotations
import json
import re
import sqlite3
import subprocess
from pathlib import Path

from brain_lib import log, upsert_node


def _slice_top_level_const(source: str, name: str) -> str | None:
    """Extract the body of a top-level `const NAME = `, `var NAME = `, or
    `let NAME = ` from a JS source. Returns the body string (still in JS
    syntax, between the opening and matching closer). None if not found
    or unbalanced. Handles single/double/template quotes and nesting of
    the same opener.
    """
    pat = re.compile(r"\b(?:const|var|let)\s+" + re.escape(name) + r"\s*=\s*")
    m = pat.search(source)
    if not m:
        return None
    i = m.end()
    while i < len(source) and source[i] in " \t\r\n":
        i += 1
    if i >= len(source):
        return None
    opener = source[i]
    if opener not in "[{":
        return None
    closer = "]" if opener == "[" else "}"
    depth = 0
    in_str = None
    escape = False
    j = i
    while j < len(source):
        ch = source[j]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == in_str:
                in_str = None
        else:
            if ch in ("'", '"', "`"):
                in_str = ch
            elif ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                if depth == 0:
                    return source[i : j + 1]
        j += 1
    return None


def _js_to_python(body: str) -> object:
    """Eval a JS object/array literal via bun, return Python data.

    We pass the body to bun via stdin so there is no temp file and no
    file-name-length issues. The script is wrapped in a function that
    shadows the DOM, so a brain literal that happens to reference
    `window` or `document` will fail loudly instead of hanging.
    """
    if not body or len(body.strip()) < 2:
        return None
    # Pass body via stdin to `bun -` so there is no temp file and no
    # file-name-length issue. Shadow the DOM so a literal that happens
    # to reference window/document fails loudly instead of hanging.
    script = (
        "var window=undefined; var document=undefined; var self=undefined; "
        "var globalThis={}; "
        "process.stdout.write(JSON.stringify((" + body + ")));\n"
    )
    try:
        r = subprocess.run(
            ["bun", "-"],
            input=script,
            capture_output=True, text=True, timeout=60,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("bun eval timed out (>60s)")
    if r.returncode != 0:
        stderr = (r.stderr or "").strip()
        first_err = stderr.splitlines()[-1] if stderr else "unknown error"
        raise RuntimeError(f"bun eval failed: {first_err}")
    out = (r.stdout or "").strip()
    if not out:
        raise RuntimeError("bun eval returned empty output")
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"bun output not JSON: {e}; first 200: {out[:200]!r}")


def _validate_node(node: dict) -> tuple[list[str], dict]:
    """Strip unknown keys; coerce types; return (errors, cleaned)."""
    errs: list[str] = []
    out: dict = {}
    if not isinstance(node, dict):
        return ["not a dict"], {}
    k = node.get("k")
    v = node.get("v")
    if not isinstance(k, str) or not k.strip():
        errs.append("missing/invalid k")
    else:
        out["k"] = k
    if not isinstance(v, str):
        errs.append("missing/invalid v")
    else:
        out["v"] = v
    t = node.get("t")
    if t is not None and not isinstance(t, str):
        errs.append("invalid t")
    else:
        out["t"] = t
    w = node.get("w")
    if w is not None:
        try:
            out["w"] = float(w)
        except (TypeError, ValueError):
            errs.append("invalid w")
    else:
        out["w"] = None
    src = node.get("source")
    if src is not None and not isinstance(src, str):
        errs.append("invalid source")
    else:
        out["source"] = src
    return errs, out


def extract_from_html(html_path: Path, conn: sqlite3.Connection, limit: int = 0) -> dict:
    """Read EMBEDDED_BRAIN + STARTER_FACTS + GREEK_NOTES from the (12) monolith."""
    text = html_path.read_text(encoding="utf-8", errors="replace")
    src_file = html_path.name
    report: dict = {
        "embedded_nodes": 0, "starter_facts": 0, "greek_notes": 0,
        "insert": 0, "update": 0, "skip": 0, "invalid": 0,
    }

    # 1. EMBEDDED_BRAIN — array of objects
    body = _slice_top_level_const(text, "EMBEDDED_BRAIN")
    if body is not None:
        try:
            arr = _js_to_python(body)
        except Exception as e:
            log(conn, src_file, "error", "EMBEDDED_BRAIN", f"eval failed: {e}")
            arr = None
        if isinstance(arr, list):
            for i, node in enumerate(arr):
                if limit and report["embedded_nodes"] >= limit:
                    break
                report["embedded_nodes"] += 1
                errs, clean = _validate_node(node)
                if errs:
                    report["invalid"] += 1
                    log(conn, src_file, "invalid", clean.get("k") or f"[{i}]", "; ".join(errs))
                    continue
                meta = {k: v for k, v in node.items()
                        if k not in {"k", "v", "t", "w", "source"}}
                action, detail = upsert_node(
                    conn, k=clean["k"], v=clean["v"],
                    t=clean["t"], w=clean["w"], source=clean["source"],
                    ref=None, greek_tr=None, greek_note=None,
                    meta=meta or None, src_file=src_file,
                )
                report[action] += 1
                log(conn, src_file, action, clean["k"], detail)
    else:
        log(conn, src_file, "skip", "EMBEDDED_BRAIN", "not found in source")

    # 2. STARTER_FACTS — object {key: string}
    body = _slice_top_level_const(text, "STARTER_FACTS")
    if body is not None:
        try:
            obj = _js_to_python(body)
        except Exception as e:
            log(conn, src_file, "error", "STARTER_FACTS", f"eval failed: {e}")
            obj = None
        if isinstance(obj, dict):
            for k, v in obj.items():
                if limit and report["starter_facts"] >= limit:
                    break
                if not isinstance(k, str) or not isinstance(v, str):
                    report["invalid"] += 1
                    log(conn, src_file, "invalid", str(k), "STARTER_FACTS entry not str/str")
                    continue
                report["starter_facts"] += 1
                # Avoid clobbering EMBEDDED_BRAIN nodes that share a key
                # (none do, but rule of thumb).
                full_k = f"starter:{k}"
                action, detail = upsert_node(
                    conn, k=full_k, v=v,
                    t="fact", w=0.9, source="STARTER_FACTS",
                    ref=None, greek_tr=None, greek_note=None,
                    meta=None, src_file=src_file,
                )
                report[action] += 1
                log(conn, src_file, action, full_k, detail)
    else:
        log(conn, src_file, "skip", "STARTER_FACTS", "not found in source")

    # 3. GREEK_NOTES — object {greek_word: {tr, note}}
    body = _slice_top_level_const(text, "GREEK_NOTES")
    if body is not None:
        try:
            obj = _js_to_python(body)
        except Exception as e:
            log(conn, src_file, "error", "GREEK_NOTES", f"eval failed: {e}")
            obj = None
        if isinstance(obj, dict):
            for greek, payload in obj.items():
                if limit and report["greek_notes"] >= limit:
                    break
                if not isinstance(payload, dict):
                    report["invalid"] += 1
                    log(conn, src_file, "invalid", str(greek), "GREEK_NOTES payload not a dict")
                    continue
                tr = payload.get("tr")
                note = payload.get("note")
                if not isinstance(note, str):
                    report["invalid"] += 1
                    log(conn, src_file, "invalid", str(greek), "GREEK_NOTES note not a string")
                    continue
                report["greek_notes"] += 1
                k = f"greek:{tr or greek}"
                v = note
                action, detail = upsert_node(
                    conn, k=k, v=v,
                    t="greek", w=0.85, source="GREEK_NOTES",
                    ref=None, greek_tr=str(tr) if tr else None, greek_note=note,
                    meta=None, src_file=src_file,
                )
                report[action] += 1
                log(conn, src_file, action, k, detail)
    else:
        log(conn, src_file, "skip", "GREEK_NOTES", "not found in source")

    return report


def extract_from_brain_json(json_path: Path, conn: sqlite3.Connection, limit: int = 0) -> dict:
    """TRU_brain.json — flat array of {k, v, w, t, source, ref}."""
    src_file = json_path.name
    report: dict = {
        "count": 0, "insert": 0, "update": 0, "skip": 0, "invalid": 0,
        "found": True,
    }
    try:
        data = json.loads(json_path.read_text(encoding="utf-8", errors="replace"))
    except Exception as e:
        log(conn, src_file, "error", None, f"json load failed: {e}")
        return {"found": False, "error": str(e)}
    if not isinstance(data, list):
        log(conn, src_file, "error", None, "expected JSON array at top level")
        return {"found": True, "count": 0, "error": "not an array"}
    for i, node in enumerate(data):
        if limit and report["count"] >= limit:
            break
        report["count"] += 1
        if not isinstance(node, dict):
            report["invalid"] += 1
            log(conn, src_file, "invalid", f"[{i}]", "not a dict")
            continue
        k = node.get("k")
        v = node.get("v")
        if not isinstance(k, str) or not isinstance(v, str):
            report["invalid"] += 1
            log(conn, src_file, "invalid", str(k) if isinstance(k, str) else f"[{i}]",
                "missing k or v")
            continue
        action, detail = upsert_node(
            conn,
            k=k, v=v,
            t=node.get("t") if isinstance(node.get("t"), str) else "bible",
            w=float(node["w"]) if node.get("w") is not None else None,
            source=node.get("source") if isinstance(node.get("source"), str) else None,
            ref=node.get("ref") if isinstance(node.get("ref"), str) else None,
            greek_tr=None, greek_note=None,
            meta=None, src_file=src_file,
        )
        report[action] += 1
        log(conn, src_file, action, k, detail)
    return report
