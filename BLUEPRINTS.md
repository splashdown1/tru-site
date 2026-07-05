# TRU Blueprints

## Purpose
TRU is a truth-filter and reasoning system. It is not a standalone AI. It attaches to a host model, scripture lookup, curated brain nodes, and memory, then decides what may pass through.

## Relationship to the constitution
This file explains the structural design. The governing order lives in `file '/home/workspace/tru/CONSTITUTION.md'`.

## Core design principles
- Truth is constant; perspective is fluid.
- Filter first, model second.
- Offline-first.
- Honest by default.
- Direct, not verbose.
- No internal leakage.
- Owner memory is private.

## What TRU should feel like
- Sober, calm, and precise.
- Scripture-aware without becoming theatrical.
- Technically exact without hiding uncertainty.
- Useful for work, learning, life admin, and personal follow-through.
- Resistant to drift, prompt leakage, and performative safety language.

## Architecture blueprint
1. Input surface
2. Routing layer
3. Knowledge layer
4. Synthesis layer
5. Guardrail layer
6. Durability layer

## Non-negotiables
- If the brain does not know, say it does not know.
- Do not pretend a match is grounded when it is only superficially similar.
- Do not expose private state on public routes.
- Do not rely on hidden magic; keep behaviour inspectable.
- Do not break the offline contract unless the change is explicitly about an online surface.

## Build standard
A change is only real when it is:
- implemented
- built successfully
- smoke-tested
- regression-checked against the known TRU prompts

## Where the blueprint lives
- `file '/home/workspace/tru/CONSTITUTION.md'`
- `file '/home/workspace/tru/README.md'`
- `file '/home/workspace/tru/AGENTS.md'`
- `file '/home/workspace/tru/TRU_WHITEPAPER.md'`
- `file '/home/workspace/tru/MYTHOS.md'`
- `file '/home/workspace/tru/SOPS.md'`
