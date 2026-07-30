# Open issues and next steps

Working state as of **2026-07-31**, `main`. `pnpm verify` green: 397 tests, 0 lint errors,
0 lint warnings. `pnpm eval -- --dry-run` passes all gates (the live eval baseline is not yet
recorded — see below).

The explanation-engine wave landed: document-order chunk fetch (`token_start` ordinal),
coverage+deepening budget fill, the teaching contract in `/api/summarize`
(hook → claim → mechanism → evidence → glossary with source labels), persona known/new
calibration read from the mastery ledger, the concept graph (`concepts` / `concept_edges` +
typed ledger signals), Semantic Scholar enrichment persisted at ingest (runtime reads
Postgres only), the four-trigger citation router in `server/explain`, pass-1 contract
rendering with render-gated exposure, and the `pnpm eval` harness with a pinned judge.

This file is a **living checklist, not a record** — when an item is done, delete it rather
than marking it ✅, and put the durable explanation in the doc that owns that subject.
Anything frozen belongs in [`archive/`](./archive/).

## Next session — start here

### Record the live eval baseline

`scripts/eval/baseline.json` is committed with `recordedAt: null`. Run
`pnpm eval -- --update-baseline` against live models once, review the scores, and commit the
result. Until then the harness gates on absolute thresholds only, not on drift from a
baseline. The judge model is pinned in `models.json` (`eval_judge`) — never point it at a
floating alias, or scores stop being comparable.

## Deferred from the explanation-engine wave (deliberate, not forgotten)

- **Tier-3 on-demand ingest of cited papers.** The citation router already detects when a
  cited paper is in the library (trigger 3) and is built ready for a "pull this citation in"
  action, but the async ingest job + sidecar progress UX needs deliberate design before it
  exists behind a user action. Do not bolt it onto the hot path.
- **Spaced-repetition scheduling / review prompts.** The mastery ledger stores everything
  scheduling would need (typed signals, exposure counts, distinct papers, last-seen, decay
  derived at read). Scheduling itself is a later product feature.
- **Page-number backfill for ar5iv ingest.** ar5iv chunks store no page numbers; conditional
  rendering removed the "(page ?)" harm, so backfill is an enhancement, not a fix.

## Smaller follow-ups

- **`docs/editor-architecture.md`** still describes the removed `EditorWorkspace`/Tiptap-ribbon
  tree. Its "Canonical helper locations" section is current; the component tree and state
  diagram are historical.
- **`docs/` is in `.gitignore`** even though files under it are tracked. New files added there
  are silently untracked — `git add -f` them or fix the ignore rule.
- **Oversized files** are a readability item only. The React Compiler blindness that made it
  look like a correctness issue was caused by a dynamic `import()` inside a component, not by
  file size, and that is fixed. Re-read the note in `git log` for `Restore React Compiler
analysis of Block.tsx` before reopening it.

## Blocked on a decision

### Product-vision docs — deliberately not written

No roadmap, product-direction, or vision document has been written, and none should be
invented from the code. This is owned by the user.

## Environment notes worth keeping

- `docker-compose.yml` pins `name: readable`. Without it Compose derives the project name from
  the directory, and this repo's worktrees are called `main` — another project on the same
  machine with a `main` directory then shares the namespace and its `docker compose up`
  deletes these containers.
- OpenRouter's `:free` slugs rotate and are retired without notice; every model configured
  before 2026-07-29 had 404'd. The paid `deepseek-v4-flash` entries in `models.json` are
  deliberate — see the `openrouter_cost` note there.
