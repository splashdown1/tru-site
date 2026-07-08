# InChristo

**InChristo** is a compact, normative knowledge contract for TRU. It is not a brain dump and it is not a glossary. It is a **schema** for binding every fact TRU ever cites to its place inside Christ.

> "In Christ" is the centre. Every fact, verse, doctrine, and concept TRU speaks of is given a **position** relative to that centre. The further a fact drifts from the centre, the lower its authority. A claim that cannot be placed is suspect by construction.

This file is the public spec. The dataset lives in `in-christo/in_christo.v1.jsonl` (JSON Lines, one record per line). The schema lives in `in-christo/in_christo.schema.json`.

## Why it exists

TRU already has a brain (curated nodes), a KJV substrate (verses), a lexicon (Strong's), and dozens of knowledge packs. The problem is not storage — it is **authority**. Three questions kept coming up:

1. Why is this fact allowed to anchor a verdict?
2. Where does this knowledge pack sit in the economy of the whole?
3. What wins when the brain, the verse, and the memory disagree?

InChristo answers those three questions in one structure. It does not replace the brain. It **ranks** the brain.

## Core idea — the Fivefold

Every InChristo record carries exactly one `position` drawn from the Fivefold:

| Position | What lives here | Default weight | Example |
|---|---|---|---|
| `CENTRE` | Christ himself, the cross, the gospel | 1.00 | John 3:16, "Christ crucified" |
| `TORAH` | Law, covenant, prophetic witness that points to the centre | 0.92 | Genesis 1:1, Isaiah 53 |
| `BODY` | The church, the saints, apostolic practice | 0.86 | Acts 2:42, 1 Cor 12 |
| `FRUIT` | The fruit of the Spirit, the visible works of faith | 0.78 | Gal 5:22-23, James 2:17 |
| `SHADOW` | Worldly knowledge, wisdom, philosophy that does not deny the centre | 0.45 | Proverbs 25:11, Acts 17:28 |

If a record has no `position`, **it is not InChristo**. If a pack refuses to place itself, its nodes are not allowed to set verdicts; they can only be referenced as footnote.

## Schema (v1)

```jsonc
{
  "id": "string, unique, kebab-case",          // e.g. "john-3-16"
  "k": "string, the human key",                // e.g. "John 3:16", "agape"
  "v": "string, the answer",                   // the body of the record
  "position": "CENTRE|TORAH|BODY|FRUIT|SHADOW",
  "w": "number in [0,1], record weight",       // default = position default
  "t": "string, type tag",                     // e.g. "verse", "lexicon", "doctrine", "worldly"
  "source": "string, who attests",             // e.g. "KJV", "BRAIN", "STARTER"
  "ref": "string?, scripture ref if any",      // e.g. "John 3:16"
  "greek_tr": "string?, transliteration",
  "greek_note": "string?, Greek note",
  "via": "string?, the linking doctrine",      // e.g. "love", "covenant", "resurrection"
  "meta": "object?, anything else"
}
```

## Authority stack (how a verdict is built)

When TRU reasons, the InChristo record stack ranks contributions like this:

1. CENTRE matches always win on tie.
2. A TORAH record that *points* to the centre (e.g. Genesis 22) beats a SHADOW record on the same topic.
3. BODY / FRUIT records are used for *how* the centre is applied.
4. SHADOW records are informative but never authoritative.
5. A memory note (from `memory/`) must declare its position before it can override a SHADOW record; it can never override CENTRE.

This is the tripwire made structural. There is no scenario where a worldly phrase can set a TRU verdict above a Christ-shaped one.

## Tripwire integration

The existing tripwire (`src/lib/tripwire.ts`) is reactive: it blocks bad content. InChristo is **proactive**: it ranks good content. Together they form a sieve — the tripwire stops the wrong shape, InChristo lifts the right one.

## File layout

```
in-christo/
├── README.md               ← this file (public spec)
├── in_christo.schema.json  ← JSON Schema (v1)
└── in_christo.v1.jsonl     ← seed dataset, one record per line
```

The JSONL format is intentional: records are appendable, the dataset can be sliced, diffed, and streamed, and the file can be loaded into SQLite FTS5, DuckDB, or a flat in-memory map without re-parsing the whole blob. JSON Lines is the durable substrate; the brain and packs are the runtime.

## Versioning

The file name carries the major version. `in_christo.v1.jsonl` will not change in place. Additions land as `in_christo.v1.jsonl` (append) or `in_christo.v2.jsonl` (breaking change). TRU prefers to append; nothing in v1 is removed.

## How a record is born

A record enters InChristo only if it can answer three questions:

1. **What is it?** (`t`)
2. **Where does it stand?** (`position`)
3. **By what path does it reach the centre?** (`via`)

If the third answer is missing, the record is parked under `SHADOW` with weight capped at 0.45 until the path becomes clear. SHADOW is not a jail — it is a *waiting room* with a low ceiling.

## What this is not

- Not a replacement for the brain. The brain is wide; InChristo is the spine.
- Not a translation layer. The text is the same English, the same Greek, the same Hebrew.
- Not a denomination. The Fivefold pre-dates the divisions; it does not pick a side.
- Not a final word. The first record in v1 is `john-3-16`. The second is `agape`. The third is `logos`. Everything else walks in from there.

## How to add a record

Append one line to `in_christo.v1.jsonl`:

```json
{"id":"your-record","k":"your key","v":"your answer","position":"CENTRE","t":"verse","source":"KJV","ref":"John 3:16"}
```

Then ask TRU. The new record is live.

— under God's sovereignty, in service of the truth that sets free.
