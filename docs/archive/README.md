# Archive — frozen point-in-time records

Everything in this directory is a **historical record**, not guidance.

- These files are **not maintained** and are **not kept in sync with the code**.
- They describe the repository as it looked on the date noted below. Most of what
  they describe has since been renamed, rewritten, or deleted.
- **Do not treat anything here as current.** For current documentation see
  [`../README.md`](../README.md).

They are kept only so that a future reader can reconstruct why a decision was made
or when a behaviour changed. If you need a fact, verify it against the code.

## Contents

| File                                   | What it recorded                                                                                                                                                                                                        | Roughly when                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `notion-ui-implementation-progress.md` | Phase-by-phase build log for the block editor (phases 1–5), listing every file created per phase.                                                                                                                       | Oct–Nov 2025                     |
| `PLAN-notion-ui.md`                    | The original implementation plan for replacing the TipTap `ResearchEditor` with the Notion-style block editor. Every phase (1–9) is marked complete and the legacy editor is gone, so the plan has been fully executed. | Nov 2025                         |
| `phase9-testing-verification.md`       | Manual verification checklist for the block editor's "Phase 9" (block CRUD, drag-and-drop, slash commands, backend wiring).                                                                                             | Nov 2025                         |
| `UNUSED_COMPONENTS_ANALYSIS.md`        | Dead-code survey proposing which legacy `components/editor/` and `components/summary/` files could be deleted. The proposed deletions have since happened.                                                              | Nov 2025                         |
| `CLEANUP_SUMMARY.md`                   | Outcome report for that deletion: which legacy editor files were removed and the verification checklist used.                                                                                                           | Nov 2025 (last touched Mar 2026) |
| `TEST_RESULTS.md`                      | A localhost sweep of 12 API endpoints with per-endpoint status codes.                                                                                                                                                   | Nov 2025 (last touched May 2026) |
| `DEPLOYMENT_TEST_RESULTS.md`           | A second localhost sweep re-run after the selection-summary citation schema fix landed.                                                                                                                                 | Nov 2025 (last touched May 2026) |
| `SCHEMA_FIX_VERIFICATION.md`           | Verification notes for the `/api/editor/selection/summary` citation schema fix (`page`/`quote` now required). The resulting invariant is documented in `../API_ANALYSIS.md`.                                            | Nov 2025                         |
| `BUG_FIX_UNKNOWN_CITATION.md`          | Before/after diff and rationale for the bug where a fallback bullet emitted `citationIds: ['unknown']` with no matching citation. The resulting invariant is documented in `../API_ANALYSIS.md`.                        | Nov 2025                         |
| `QA_SUMMARY.md`                        | A single `tsc --noEmit` run recording a TipTap `toggleUnderline` typing error in `components/editor/EditorToolbar.tsx` — a file that no longer exists.                                                                  | Mar 2026                         |
| `chat-bot-update-notes.html`           | Standalone HTML working notes from the chat-bot update effort.                                                                                                                                                          | May–Jun 2026                     |
| `issue-resolving-notes.html`           | Standalone HTML working notes from an issue-resolution pass.                                                                                                                                                            | May–Jun 2026                     |
| `autoplan-implementations-notes.html`  | Standalone HTML working notes from an `/autoplan` run.                                                                                                                                                                  | Jun 2026                         |
