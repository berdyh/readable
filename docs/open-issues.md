# Open issues and next steps

Working state as of **2026-07-31**, branch `feat/explanation-engine`. `pnpm verify` green:
458 tests, 0 lint errors, 0 lint warnings. `pnpm eval -- --dry-run` passes all gates (the
live eval baseline is not yet recorded — see below).

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

Items are grouped by component, then priority: **P0** (drop everything) through **P4**
(someday). This file is the single tracker for this repo — there is deliberately no
`TODOS.md`, because two lists of the same truth drift apart.

## Reader — pass toggle discards in-progress edits

**Priority:** P1 · **Surfaced by:** /ship pre-landing review (coverage audit), 2026-07-31

Switching ThreePass passes regenerates `initialBlocks`, and the store effect in
`block-editor/store.tsx` replaces every block on identity change — so any edit the reader
made is discarded. The mechanism predates the explanation-engine wave (any summary arrival
did this), but pass-aware rendering turned it into a one-click loss.

- **Repro:** open a paper signed in, edit a block on the skim pass, switch to read → edits gone.
- **Why it is not a patch:** the fix is per-pass block state or dirty-checking in the editor
  store, i.e. editor state architecture. Rushing it into the ship wave risked new editor bugs.
- **Start at:** `src/app/components/workspace/ReaderWorkspace.tsx` (pass → initialBlocks),
  `src/app/components/block-editor/store.tsx` (the replace-on-change effect).
- **Wants:** an E2E test for the repro above, since neither half is wrong in isolation.

## Reader — source labels are invisible on the reading surface

**Priority:** P2 · **Surfaced by:** /ship design review, 2026-07-31

Contract blocks carry a server-validated `metadata.sourceLabel`
(`model_knowledge` / `cited_text`), and chat renders the equivalent as a trust chip, but no
block renderer reads it — so provenance shows in chat and silently vanishes in the product's
main reading view. The plumbing is correct and tested; only rendering is missing.

- **Pros:** honesty about what the model knows vs. what the paper says, where most reading happens.
- **Cons/why deferred:** chip placement in reading flow is a visual-hierarchy question, worth
  a `/design-review` rather than a rushed inline chip.
- **Start at:** `src/app/components/block-editor/parsers.ts` (sets the metadata),
  `src/app/components/chat/primitives/answer-card.tsx` (`SourceLabelChip`, the pattern to match).
- Also unify the `new_terms` inline `*(from cited text)*` suffix with whatever chip lands.

## Concept graph — provenance required before any cross-user read path

**Priority:** P1 (blocking precondition, not scheduled work) · **Surfaced by:** /ship security review, 2026-07-31

`concepts` and `concept_edges` are global tables written last-writer-wins from LLM output
over user-ingested papers, with no record of which paper or user produced a node or edge.
Nothing reads them cross-user today, so the risk is latent — **but shipping any cross-user
read path without provenance turns this into a stored cross-user injection channel**, where
one malicious paper poisons shared descriptions and prerequisite ordering for everyone.

- **Required before that read path ships:** provenance columns (`paper_id` and/or `user_id`)
  on nodes and edges; treat `display_name`/`description` as untrusted text at every render or
  prompt-composition site; consider requiring corroboration from multiple sources before an
  LLM-sourced description overwrites an existing shared one.
- **Start at:** `src/server/db/concepts.ts`, `src/server/persona/record.ts` (`recordConceptGraph`).
- Length caps and control-character stripping already landed this wave; they bound the blast
  radius but do not establish provenance.

## Eval — record the live baseline

**Priority:** P2 · **Blocked by:** nothing (needs one live model run)

`scripts/eval/baseline.json` is committed with `recordedAt: null`. Run
`pnpm eval -- --update-baseline` against live models once, review the scores, and commit the
result. Until then the harness gates on absolute thresholds only, not on drift from a
baseline. The judge model is pinned in `models.json` (`eval_judge`) — never point it at a
floating alias, or scores stop being comparable.

Known flake: long fixtures can exceed the provider timeout; raise it for the run
(`OPENROUTER_TIMEOUT_MS=420000 pnpm eval -- --update-baseline`) rather than lowering the gate.

## Explanation engine — deferred by design (not forgotten)

**Priority:** P3

- **Tier-3 on-demand ingest of cited papers.** The citation router already detects when a
  cited paper is in the library (trigger 3) and is built ready for a "pull this citation in"
  action, but the async ingest job + sidecar progress UX needs deliberate design before it
  exists behind a user action. Do not bolt it onto the hot path.
- **Spaced-repetition scheduling / review prompts.** The mastery ledger stores everything
  scheduling would need (typed signals, exposure counts, distinct papers, last-seen, decay
  derived at read). Scheduling itself is a later product feature.
- **Page-number backfill for ar5iv ingest.** ar5iv chunks store no page numbers; conditional
  rendering removed the "(page ?)" harm, so backfill is an enhancement, not a fix.

## Docs and housekeeping

**Priority:** P4

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
