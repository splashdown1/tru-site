#!/usr/bin/env python3
"""Prune near-duplicate memory entries by kind + token overlap.
Transitive clustering: re-scans until stable so terse captures
('joe', 'texas') all merge into the richest natural-language entry."""
import json, re, sys, os

MEM = "/home/workspace/tru-site/memory/TRU_memory.json"
STOP = set("a an the is are was were i my mine me we our he she it its his her "
           "name user user's users s t that this these those and or of to in on "
           "for with as at by from into than then so do does did be been being "
           "have has had will would can could should would may might must not no "
           "yes very more most about what who whom which when where why how up down "
           "out over under again here there also too just only own same other some "
           "such any all each both few many much one two he's i'm i'm im lives live "
           "living lived prefer prefers use uses used self need needs require requires requirement dont don t do does done make makes get got like likes want wants good great new old first last time now thing things stuff way ways".split())

def tokens(t):
    t = re.sub(r"[^a-z0-9\s]", " ", str(t).lower())
    return {w for w in t.split() if w not in STOP and len(w) > 1}

def similar(a, b):
    if not a or not b:
        return False
    if a <= b or b <= a:
        return True
    inter = len(a & b)
    if not inter:
        return False
    return inter / len(a | b) >= 0.5

m = json.load(open(MEM))
entries = m.get("entries", [])
print(f"before: {len(entries)} entries, v{m.get('version')}")

# group by kind
from collections import defaultdict
by_kind = defaultdict(list)
for e in entries:
    by_kind[e.get("kind", "?")].append(e)

kept = []
dropped = []
for kind, group in by_kind.items():
    # transitive clustering
    clusters = []  # each: {rep, toks, members}
    for e in group:
        tk = tokens(e.get("text", ""))
        merged = False
        for c in clusters:
            if similar(tk, c["toks"]):
                c["members"].append(e)
                c["toks"] |= tk
                if len(str(e.get("text",""))) > len(str(c["rep"].get("text",""))):
                    c["rep"] = e
                merged = True
                break
        if not merged:
            clusters.append({"rep": e, "toks": tk, "members": [e]})
    # re-pass: merge clusters that became similar via transitive expansion
    changed = True
    while changed:
        changed = False
        for i in range(len(clusters)):
            for j in range(i+1, len(clusters)):
                if similar(clusters[i]["toks"], clusters[j]["toks"]):
                    a, b = clusters[i], clusters[j]
                    a["members"] += b["members"]
                    a["toks"] |= b["toks"]
                    if len(str(b["rep"].get("text",""))) > len(str(a["rep"].get("text",""))):
                        a["rep"] = b["rep"]
                    clusters[j] = None
                    changed = True
        clusters = [c for c in clusters if c is not None]
    for c in clusters:
        kept.append(c["rep"])
        for mem in c["members"]:
            if mem is not c["rep"]:
                dropped.append(mem)

# preserve original entry order
kept_ids = {id(e) for e in kept}
final = [e for e in entries if id(e) in kept_ids]
m["entries"] = final
m["version"] = (m.get("version") or 0) + 1

json.dump(m, open(MEM, "w"), indent=1)
print(f"after: {len(final)} entries, v{m['version']}")
print(f"dropped {len(dropped)}:")
for d in dropped:
    print(f"  [{d.get('kind','?')}] {str(d.get('text',''))[:60]}")
