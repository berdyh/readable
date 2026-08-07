# Open issues and next steps

Working state: `main` at `v0.2.0.0` — the explanation-engine wave merged as PR #23 (`1ab4131`),
then the reader-state and correctness fixes as PR #24 (`5cf90e1`) and PR #25 (`e91fb52`).
`pnpm verify` green on the merged tree: 0 lint errors, 0 lint warnings.
`pnpm eval -- --dry-run` passes all gates; the live eval baseline is not yet recorded
(see below).

The explanation-engine wave landed: document-order chunk fetch (`token_start` ordinal),
coverage+deepening budget fill, the teaching contract in `/api/summarize`
(hook → claim → mechanism → evidence → glossary with source labels), persona known/new
calibration read from the mastery ledger, the concept graph (`concepts` / `concept_edges` +
typed ledger signals), Semantic Scholar enrichment persisted at ingest (runtime reads
Postgres only), the four-trigger citation router in `server/explain`, pass-1 contract
rendering with render-gated exposure, and the `pnpm eval` harness with a pinned judge.

This file is a **living checklist, not a record** — when an item is done, delete it rather
than marking it ✅, and put the durable explanation in the doc that owns that subject.
Anything frozen belongs in [`archive/`](./archive/). What shipped is recorded in
`CHANGELOG.md` and the PR, not here.

Items are grouped by component, then priority: **P0** (drop everything) through **P4**
(someday). This file is the single tracker for this repo — there is deliberately no
`TODOS.md`, because two lists of the same truth drift apart.

---

## Next session — start here

**No P1 item remains.** The concept-graph provenance work landed, and with it the last
blocking item. The calendar-drifting citation-router cutoff is now fixed — the constant
stayed at 2025 (no behaviour change) and a test in `src/server/explain/explain.test.ts`
now fails loudly if it ever falls more than a year behind the real current year. That
leaves one P2 worth doing first:

1. **Record the live eval baseline** (below). One live model run, and the harness stops
   gating on absolute thresholds only.

Everything else in this file is context, not queue.

---

## Concept graph — the read path is still unbuilt

**Priority:** P3 · **Status:** provenance landed 2026-08-07; nothing reads the graph yet

The read model is settled and implemented on the storage side: **the skeleton (keys and
edges) is global but attributed, and every human-readable string stays per-user in
`persona_concepts`.** `concepts.display_name` / `concepts.description` still have zero
readers anywhere in the tree, and the first implementer of a read path must keep it that way:

- **Never render or prompt with stored `display_name` / `description`.** They are LLM output
  derived from arbitrary uploaded documents. Derive a display string from the normalized
  concept key, or read the user's own row in `persona_concepts` — which is already the render
  source and already handles cold start.
- **Rank and filter on `corroborated`, not on `confidence`.** `fetchConceptEdgesByFromKeys`
  returns both, plus `paperIds`. `confidence` is self-reported by the model that produced the
  edge; `corroborated` means the edge was read out of cited text or asserted independently by
  at least two papers.
- Writes are never rejected and never should be. `cardinality(paper_ids)` is the agreement
  counter, and it is also the rollback handle: a bad contributor is found by the paper id, not
  by re-running anything.

**Start at:** `src/server/db/concepts.ts` (`fetchConceptEdgesByFromKeys`, still with no
callers) and `src/server/db/persona.ts` (`fetchConceptLedgerForUser`, the per-user text).

---

## Concept graph — citation edges name the summarization, not the source

**Priority:** P2 · **Surfaced by:** codex review of the provenance wave, 2026-08-07

`groundLowFamiliarityTerms` (`src/server/summarize/index.ts`) builds its prompt from up to
eight **cited** papers' abstracts and extracts prerequisite pairs out of that text — then
records the paper being _summarized_ as the provenance for every resulting edge.

So the two questions provenance is supposed to answer come apart:

- "Remove what paper A contributed" — works. A is genuinely the summarization that produced
  the row.
- "Find everything derived from cited work B, which turned out to be wrong" — does not work.
  B is not recorded anywhere on the edge.

**It does not inflate trust.** `corroborated` treats a `source = 'citation'` edge as trusted
on its own and never consults `cardinality(paper_ids)` for it, so several papers citing one
bad source cannot masquerade as independent agreement. Worth re-checking if that short-circuit
is ever removed.

The fix is not a patch: the grounding response would have to name which citation supported
which term, which means changing `TERM_GROUNDING_SCHEMA` and the `term_grounding` prompt —
a schema-enforced LLM contract. This repo has already shipped one unvalidated LLM-contract
change that failed silently (see the OpenRouter truncation note below), so this wants an eval
run, not a guess. The cited work also usually has no `papers` row, so the identifier would be
the citation's arXiv id or DOI rather than a `paper_id`.

**Start at:** `groundLowFamiliarityTerms` and `TERM_GROUNDING_SCHEMA` in
`src/server/summarize/index.ts`, and `term_grounding` in `src/server/llm-config/prompts.json`.

---

## Correctness — found in the ship review, not yet fixed

### Degraded re-ingest drops citation-to-chunk anchors

**Priority:** P3 · `src/server/db/papers.ts:496,600`

`chunk_ids = EXCLUDED.chunk_ids` is the one citation field overwritten unconditionally while
every other field COALESCE-preserves. If a paper is re-ingested through a path that maps no
references to chunks (e.g. ar5iv previously, PDF fallback later), stored anchors reset to
`{}` and citation-reveal navigation loses its targets — even though the S2 enrichment on the
same row survives.

Arguably correct as written (fresh chunk ids are re-derived; stale ones would dangle), so
this is a **deliberate-tradeoff note**, not a confirmed bug. If anchor loss matters, preserve
stored `chunk_ids` when the incoming array is empty, mirroring the `authors` CASE guard.

### Legacy persona rows never join the ledger

**Priority:** P3 · `src/server/db/persona.ts`

Rows written before the concept-graph wave hold raw concept strings; ledger rows hold
normalized `{domain}:{key}` keys. The same concept can exist twice for one user
(`Transformer` and `ml:transformer`), and pre-wave reading history contributes nothing to
derived mastery. Read paths tolerate the zero-state defaults, so nothing is broken — but the
calibration is quietly less informed than it looks. Fix, if wanted: a one-time best-effort
backfill mapping legacy strings through the `server/explain` normalizer, merging duplicates.

---

## Performance — measured, not urgent

**Priority:** P3

- **N+1 writes on the concept-graph path.** `upsertConcepts` and `upsertConceptEdges`
  (`src/server/db/concepts.ts`) and `recordConceptSignal` (`src/server/db/persona.ts`)
  each issue one `INSERT ... ON CONFLICT` per row inside a loop. Bounded today (≤8 concepts ×
  ≤4 prerequisites per interaction) and fire-and-forget, but it is the classic batchable shape
  on a path every QA/summarize/selection interaction touches. Fix: multi-row `VALUES` or
  `unnest($1::text[], ...)` with the same conflict clause.
- **Schema DDL takes table locks on every cold start.** The `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` statements in `ensureSchema()` acquire `ACCESS EXCLUSIVE` on `paper_citations` and
  `persona_concepts` even when the columns already exist (`IF NOT EXISTS` skips the change,
  not the lock), inside one transaction. Harmless for a mostly single-instance local-first app
  on PG16; if multi-instance deploys ever matter, gate the block behind an
  `information_schema.columns` check or set a `lock_timeout` so a blocked migration fails fast.
- **`/api/persona/exposure` has no rate limit.** Cosmetic today: the route is auth-gated and an
  authenticated caller can only inflate their _own_ ledger, and field lengths and concept
  counts are now capped. Worth a limit if the ledger ever feeds anything shared.
- **Double sort on chunk fetch.** `fetchPaperChunksByPaperId` orders in SQL and then re-sorts
  in JS with a comparator whose semantics differ from the SQL collation. The JS sort is
  authoritative; the SQL `ORDER BY` is redundant work (keep it only as a stable pre-sort, or
  drop it once legacy `NULL`-ordinal rows are gone).

---

## Test coverage — the honest number

**Priority:** P2

The ship audit traced 67 paths through the diff and found **31 covered (46%)** — code paths
43%, user flows 57%, LLM behavior covered by `pnpm eval`. All **9 flagged regressions**
(changed behavior with no covering test) were fixed before merge; **36 gaps remain**, of which
7 want E2E and 2 want eval cases.

The gaps worth closing first, because they guard data correctness rather than rendering:

- `src/server/db/persona.ts` — `recordConceptSignal`'s ledger upsert carries the subtlest
  persistence semantics in the wave (per-signal `jsonb` counter increment, `distinct_paper_ids`
  dedupe CASE, COALESCE name/description) with no SQL-shape test. `papers.test.ts` pins its
  sibling upsert exactly this way — mirror that.
- `src/server/qa/context.ts` — a 165-line rewrite (live enrichment → Postgres-only) with zero
  direct tests; its `citationCount` mapping feeds the router's obscurity trigger, so a wrong
  mapping silently disables retrieval.
- `/api/persona/exposure` — the only new route with neither a unit test of the handler nor a
  probe in `scripts/test-api-endpoints.ts`.

---

## Reader — source labels are invisible on the reading surface

**Priority:** P2 · **Surfaced by:** /ship design review, 2026-07-31

Contract blocks carry a server-validated `metadata.sourceLabel`
(`model_knowledge` / `cited_text`), and chat renders the equivalent as a trust chip, but no
block renderer reads it — so provenance shows in chat and silently vanishes in the product's
main reading view. The plumbing is correct and tested; only rendering is missing.

- **Why deferred:** chip placement in reading flow is a visual-hierarchy question, worth a
  `/design-review` rather than a rushed inline chip.
- **Start at:** `src/app/components/block-editor/parsers.ts` (sets the metadata),
  `src/app/components/chat/primitives/answer-card.tsx` (`SourceLabelChip`, the pattern to match).
- Unify the `new_terms` inline `*(from cited text)*` suffix with whatever chip lands.
- Related, same area: on the skim pass the paper HTML renders first and is then wholesale
  replaced when the summary arrives, with no loading state or transition. Verify visually
  whether that reads as a glitch. (Reader edits now survive that swap, but the swap itself is
  still abrupt — the fix was about state, not transition.)

---

## Reader — the markdown round trip collapses single newlines

**Priority:** P3 · **Surfaced by:** fixing the unlock-rewrites-content bug, 2026-08-06

`parseSelectionSummaryToBlocks` joins a selection summary's bullets with `\n`
(`parsers.ts`), but `marked` runs with `breaks: false`, so a single newline renders as a
soft break and Turndown reads it back as a space. The first time such a callout is unlocked
its bullets collapse onto one line — the same "unlocking rewrites the block" symptom as the
block-marker bug, but a different cause, and it survives that fix.

Same shape for any paragraph whose text carries single newlines. Turndown's escaping is a
third instance: a paragraph containing `x_i` comes back as `x\_i`.

- **Start at:** the `breaks` option in `src/app/components/block-editor/utils/markdown.ts`
  and the `\n` join in `parsers.ts`. The known-loss cases are pinned as tests at the bottom
  of `utils/markdown.test.ts`, so a fix has somewhere to land.
- Deciding whether a soft break should become `<br>` is a rendering choice, not just a
  serializer bug — a callout of bullets and a wrapped paragraph want different answers.

---

## Reader — passes 2 and 3 render identical content

**Priority:** P3 · **Surfaced by:** the pass-toggle investigation, 2026-08-06

`pass` reaches content selection in exactly one place — `usePaperContent.ts`,
`summaryIsPrimary = pass === "skim" && Boolean(effectiveSummary)`. So read and deep resolve to
the same memoized paper-HTML block array; the only difference a reader sees between them is
the guidance-card text in `usePassState.ts:40-61`.

That may be the intended product design (same text, different instruction to the reader), or
it may be an unfinished third pass. Worth an explicit decision rather than leaving it as an
accident of the code: if deep is meant to differ, nothing currently makes it differ.

---

## Eval — record the live baseline

**Priority:** P2 · **Blocked by:** nothing (needs one live model run)

`scripts/eval/baseline.json` is committed with `recordedAt: null`. Run
`pnpm eval -- --update-baseline` against live models once, review the scores, and commit the
result. Until then the harness gates on absolute thresholds only, not on drift from a
baseline. The judge model is pinned in `models.json` (`eval_judge`) — never point it at a
floating alias, or scores stop being comparable.

Known flake: long fixtures can exceed the provider timeout; raise it for the run
(`OPENROUTER_TIMEOUT_MS=420000 pnpm eval -- --update-baseline`) rather than lowering the gate.
Partial live runs during the ship scored coverage 0.97, hook 0.88, plain language 0.80,
mechanism 0.90, evidence 0.95, glossary 0.90+, edge validity 1.00 — all above threshold.

---

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

---

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
- **OpenRouter can silently truncate a prompt and return HTTP 200 with `{}`.** An upstream
  provider cut the summarize prompt to exactly 2048 tokens and the model answered with an
  empty object — a success response no failover path caught, invisible to unit tests and code
  review. JSON calls now send `provider.require_parameters` + `transforms: []` and reject
  degenerate `{}`/`[]` completions. The eval harness found this; keep it in the loop when
  changing providers.
