#!/usr/bin/env python3
"""Vendor brain + KJV data so tru-site boots with real knowledge on this instance.
- brain: extract .nodes -> bare array (ensureBrainDb expects Array<node>).
- kjv: kjv_full.json (array of {ref,text,abbrev}) -> { "<code> <ch>:<vs>": text, ... }
  keyed by the BOOK_ALIAS code form that parseVerse produces, plus full-name
  space + underscore forms as fallbacks.
"""
import json, re, os

SRC_BRAIN = "/home/workspace/TRU-release/current/brain.json"
SRC_KJV   = "/home/workspace/TRU-release/data/kjv_full.json"
DST_DIR   = "/home/workspace/TRU"
DST_BRAIN = os.path.join(DST_DIR, "TRU_BRAIN_41.json")
DST_KJV   = os.path.join(DST_DIR, "kjv_lookup.json")

os.makedirs(DST_DIR, exist_ok=True)
os.makedirs(os.path.join(DST_DIR, "ghost"), exist_ok=True)

# ── brain ──────────────────────────────────────────────────────
with open(SRC_BRAIN) as f:
    brain_obj = json.load(f)
nodes = brain_obj["nodes"] if isinstance(brain_obj, dict) and "nodes" in brain_obj else brain_obj
assert isinstance(nodes, list) and nodes, f"brain nodes not a non-empty array (got {type(nodes)})"
with open(DST_BRAIN, "w") as f:
    json.dump(nodes, f, separators=(",", ":"))
print(f"brain: {len(nodes)} nodes -> {DST_BRAIN} ({os.path.getsize(DST_BRAIN)//1024} KB)")

# ── BOOK_ALIAS (copied from server.ts) ─────────────────────────
BOOK_ALIAS = {
  "gen":"gen","genesis":"gen","gn":"gen",
  "ex":"exo","exo":"exo","exodus":"exo",
  "lev":"lev","le":"lev","lv":"lev",
  "num":"num","nu":"num","nb":"num",
  "deut":"deu","deu":"deu","dt":"deu",
  "josh":"jos","jos":"jos","jsh":"jos",
  "jdg":"jdg","judg":"jdg","jdgs":"jdg",
  "rut":"rut","ruth":"rut","rth":"rut",
  "1sa":"1sa","1sam":"1sa","1samuel":"1sa",
  "2sa":"2sa","2sam":"2sa","2samuel":"2sa",
  "1ki":"1ki","1kings":"1ki",
  "2ki":"2ki","2kings":"2ki",
  "1ch":"1ch","1chr":"1ch","1chronicles":"1ch",
  "2ch":"2ch","2chr":"2ch","2chronicles":"2ch",
  "ezr":"ezr","ezra":"ezr",
  "neh":"neh","nehemiah":"neh",
  "est":"est","esth":"est","ester":"est",
  "job":"job","jb":"job",
  "ps":"ps","psa":"ps","psalm":"ps","psalms":"ps",
  "prov":"pro","pro":"pro","pr":"pro",
  "ecc":"ecc","eccl":"ecc","ec":"ecc","qoh":"ecc",
  "sng":"sng","song":"sng","songs":"sng","sos":"sng",
  "isa":"isa","isaiah":"isa","is":"isa",
  "jer":"jer","jr":"jer",
  "lam":"lam","lamentations":"lam",
  "ezk":"ezk","ezk":"ezk","ezek":"ezk","eze":"ezk",
  "dan":"dan","dn":"dan",
  "hos":"hos","hosea":"hos",
  "jol":"jol","joel":"jol",
  "amo":"amo","amos":"amo",
  "oba":"oba","obad":"oba","obadiah":"oba",
  "jon":"jon","jonah":"jon",
  "mic":"mic","micah":"mic",
  "nam":"nam","nah":"nam",
  "hab":"hab","habakkuk":"hab",
  "zep":"zep","zeph":"zep",
  "hag":"hag","haggai":"hag",
  "zec":"zec","zech":"zec",
  "mal":"mal","malachi":"mal",
  "mt":"mt","matt":"mt","matthew":"mt",
  "mk":"mk","mark":"mk","mar":"mk","mr":"mk",
  "lk":"lk","luke":"lk","lu":"lk",
  "jn":"jn","john":"jn","jhn":"jn",
  "ac":"ac","acts":"ac","act":"ac",
  "rom":"rom","romans":"rom","rm":"rom",
  "1co":"1co","1cor":"1co","1corinthians":"1co",
  "2co":"2co","2cor":"2co","2corinthians":"2co",
  "gal":"gal","galatians":"gal","ga":"gal",
  "eph":"eph","ephesians":"eph",
  "phil":"phil","philippians":"phil","php":"phil",
  "col":"col","colossians":"col",
  "1th":"1th","1thes":"1th","1thess":"1th","1thessalonians":"1th",
  "2th":"2th","2thes":"2th","2thess":"2th","2thessalonians":"2th",
  "1ti":"1ti","1tim":"1ti","1timothy":"1ti",
  "2ti":"2ti","2tim":"2ti","2timothy":"2ti",
  "tit":"tit","titus":"tit",
  "phm":"phm","philemon":"phm",
  "heb":"heb","hebrews":"heb",
  "jas":"jas","james":"jas","jam":"jas",
  "1pe":"1pe","1pet":"1pe","1peter":"1pe",
  "2pe":"2pe","2pet":"2pe","2peter":"2pe",
  "1jn":"1jn","1john":"1jn","1jhn":"1jn",
  "2jn":"2jn","2john":"2jn","2jhn":"2jn",
  "3jn":"3jn","3john":"3jn","3jhn":"3jn",
  "jud":"jud","jude":"jud",
  "rev":"rev","revelation":"rev","ap":"rev",
}

# ref looks like "Genesis 1:1", "1 Chronicles 1:1", "Song of Solomon 1:1"
REF_TAIL = re.compile(r"\s+(\d+):(\d+)$")
lookup = {}
misses = set()
with open(SRC_KJV) as f:
    verses = json.load(f)
for v in verses:
    ref = v["ref"]
    text = v["text"]
    m = REF_TAIL.search(ref)
    if not m:
        misses.add(ref); continue
    ch, vs = m.group(1), m.group(2)
    bookname = ref[:m.start()].strip().lower().replace(" ", "")
    ab = v.get("abbrev", "").lower().replace(" ", "")
    code = BOOK_ALIAS.get(ab) or BOOK_ALIAS.get(bookname) or ab or bookname
    if not code:
        misses.add(ref); continue
    full = ref[:m.start()].strip().lower()  # "genesis", "1 chronicles"
    keys = [
        f"{code} {ch}:{vs}",   # server refKey + ghost ref1 (code + space)
        f"{code}{ch}:{vs}",    # ghost ref2 (code, no space)
    ]
    for k in keys:
        lookup.setdefault(k, text)

with open(DST_KJV, "w") as f:
    json.dump(lookup, f, separators=(",", ":"))
print(f"kjv: {len(verses)} verses -> {len(lookup)} keys -> {DST_KJV} ({os.path.getsize(DST_KJV)//1024} KB)")
if misses:
    print(f"WARNING: {len(misses)} refs unmatched, e.g. {list(misses)[:10]}")
else:
    print("kjv: all refs matched to BOOK_ALIAS codes")
# spot checks
for probe in ("gen 1:1", "jn 3:16", "1jn 1:1", "1co 13:4", "ps 23:1", "rev 22:21"):
    print(f"  {probe!r:12} -> {'OK' if probe in lookup else 'MISSING'}")
