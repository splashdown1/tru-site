# TRU SOPs

## 1) Before changing anything
- Read `file '/home/workspace/tru/CONSTITUTION.md'`.
- Read `file '/home/workspace/tru/README.md'`.
- Read `file '/home/workspace/tru/AGENTS.md'`.
- If the task touches identity, doctrine, or visual language, also read `file '/home/workspace/tru/TRU_WHITEPAPER.md'` and `file '/home/workspace/tru/MYTHOS.md'`.

## 2) Audit SOP
When asked to audit TRU:
1. Inspect the relevant files first.
2. Identify concrete failures, not vague impressions.
3. Separate behaviour bugs from documentation gaps.
4. Report the smallest useful fix set.
5. Keep the summary short and actionable.

## 3) Patch SOP
When changing TRU:
1. Edit the smallest surface that solves the problem.
2. Preserve the existing architecture unless the change is explicitly architectural.
3. Avoid introducing new dependencies unless the project already supports them.
4. Keep public output clean.
5. Do not add comments or clutter unless they materially help future maintenance.

## 4) Verify SOP
After every meaningful patch:
1. Run a build.
2. Run a server smoke test if the change touches runtime behaviour.
3. Check the affected user flow.
4. Re-run known regression prompts when retrieval or memory changes.
5. Confirm the result before moving on.

## 5) Standard regression prompts
- John 3:16
- what is TRU
- what do you remember about me
- an unknown query that should trigger honest gap behaviour
- a prompt that previously caused internal leakage

## 6) Build and runtime SOP
- Use `bun run build` for production validation.
- Do not manually run long-lived site processes; Zo manages them.
- For quick smoke checks, run the server briefly and inspect the logs.
- If the server fails at boot, fix the boot error first before trying UI work.

## 7) Publishing SOP
Before publishing a route or site:
1. Inspect what already exists.
2. Avoid overwriting live public surfaces without confirming the intent.
3. Build first.
4. Publish only after the new state is verified.
5. Report the URL and visibility clearly.

## 8) Memory SOP
- Public `/api/tru/ask` stays brain + scripture only.
- Private memory belongs behind gates.
- Archive memory deliberately.
- Do not let owner-private knowledge leak into public answers.

## 9) Security SOP
- Any route that writes to disk or exposes private state must be gated.
- Use bearer auth for sensitive endpoints.
- Treat header-based trust as system-level convenience, not real auth.
- Keep the offline runtime airgapped unless a change explicitly requires otherwise.

## 10) Documentation SOP
When the architecture changes:
- update `file '/home/workspace/tru/CONSTITUTION.md'`
- update `file '/home/workspace/tru/README.md'`
- update `file '/home/workspace/tru/AGENTS.md'` if the working rules change
- update `file '/home/workspace/tru/TRU_WHITEPAPER.md'` if the philosophy changes
- update `file '/home/workspace/tru/MYTHOS.md'` if the symbolic surface changes

## 11) Restore SOP
If a change goes wrong:
1. Revert the smallest affected file.
2. Rebuild.
3. Smoke-test again.
4. Prefer a clean rollback over a clever workaround.
