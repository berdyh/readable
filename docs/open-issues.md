# Open issues and next steps

Working state as of **2026-07-29**, branch `feat/chat-panel-resizer` (36 commits ahead of
`main`, nothing pushed, `pnpm verify` green: 29 test files, 230 tests, 0 lint errors).

This file exists so the state of the work survives between sessions. It is a **living
checklist, not a record** — when an item is done, delete it from here rather than marking
it ✅, and put the durable explanation in the doc that owns that subject. Anything frozen
belongs in [`archive/`](./archive/).

## Blocked on a decision

Two threads are waiting on input and should not be started before it arrives.

### 1. Module/submodule pass — waiting on the humora v2 structure

The intent is to divide this repo into clear modules and submodules following the pattern
used in the humora v2 monorepo. That pattern is not recorded anywhere on this machine: the
gstack project state survives under `~/.gstack/projects/humora_v2.uz-mono-humora-v2.0/`,
but the checkout at `/home/shoh/Projects/gitlab/humora-v2.uz/mono-humora-v2.0/` is gone.

What is needed before the pass can start:

- Is it a real monorepo with workspace packages (`packages/*` + a workspace file), or a
  single app with enforced internal module boundaries?
- How are boundaries **enforced** — ESLint `no-restricted-imports`, per-module `index.ts`
  public surfaces, path aliases, or convention alone?

Why it matters here: `src/app/components/chat/` already has a public surface
(`chat/index.ts`) and today exactly one outside consumer imports through it. **Nothing
mechanically prevents a deep import** into `chat/model/` or `chat/hooks/` — the boundary
holds by discipline. The same is true of `src/server/*`. Whatever humora does to enforce
this is the thing to copy.

### 2. Product-vision docs — deliberately not written

No roadmap, product-direction, or vision document has been written, and none should be
invented from the code. This is owned by the user and comes after the module pass.

## Verification gaps

### The authenticated surface has never been exercised since the restructure

The largest residual risk in the tree. The chat sidecar restructure was verified by
typecheck, lint, unit tests, code review, and live browser checks of the **signed-out**
sidecar, resizer geometry, both themes, mobile reflow, and the paper view. Everything
behind Clerk sign-in rests on types and review alone:

- sending and receiving a message
- session persistence across a reload
- chat tab deletion and its confirmation step
- slash-command dispatch
- citation click → block scroll/reveal
- insert-answer into the document

The harness already exists — the bearer-token recipe in `README.md` and
[`API_TESTING.md`](./API_TESTING.md) — so this is a coverage gap, not a tooling gap. One
signed-in smoke pass covers all six.

### There are no rendering tests

`vitest.config.ts` runs in the `node` environment, so component tests exercise pure
helpers only (`commands`, `parsers`, `blockInteractionUtils`, `blockNavigation`,
`chat/model/types`). Nothing renders a component. This is a deliberate constraint — it is
why the citation→block resolver was kept pure and testable — but it means any bug that
only appears once React runs is invisible to `pnpm verify`.

## Structural

### Oversized files, and the lint findings hiding in them

Two `react-hooks/set-state-in-effect` errors surfaced while `ChatIntegration.tsx` (935
lines) was being split. They were **not introduced by the split**: the rule had never
fired because the file was too large for the compiler to analyze. A clean lint run over a
large component is weak evidence.

The largest remaining non-test files, most likely to be hiding the same class of finding:

| Lines | File                                                           |
| ----- | -------------------------------------------------------------- |
| 744   | `src/server/llm/providers/local-coding-agent.ts`               |
| 735   | `src/server/db/papers.ts`                                      |
| 699   | `src/server/ingest/pipeline.ts`                                |
| 688   | `src/server/summarize/index.ts`                                |
| 482   | `src/app/components/block-editor/Block.tsx`                    |
| 477   | `src/app/components/block-editor/parsers.ts`                   |
| 451   | `src/app/components/workspace/pdf/PdfViewerWithHighlights.tsx` |
| 442   | `src/server/editor/selection.ts`                               |

Budget for fixing what a split exposes rather than treating it as a regression the split
caused.

### Module boundaries are unenforced

See [Blocked on a decision](#1-modulesubmodule-pass--waiting-on-the-humora-v2-structure).
`chat/index.ts` and the `src/server/*` module surfaces are conventions, not rules.

## Code hygiene

- **18 ESLint warnings, 0 errors**, in 10 files — 14 `no-unused-vars` (5 alone in
  `block-editor/parsers.ts`) and 4 `no-img-element` (`FigureBlock.tsx`,
  `workspace/pdf/FigureCallouts.tsx`). All pre-existing; none introduced by the 2026-07-28
  wave.
- **Prettier does not run on TypeScript.** `lint-staged` runs ESLint on `.ts/.tsx` but
  Prettier only on css/md/json/yml, so import quoting is split across the codebase (34
  files single-quoted, 88 double-quoted). Match the file you are editing. Fixing this
  properly means one formatting-only commit plus a `lint-staged` change — keep it separate
  from behavior changes.
- **`src/app/test-block-editor/`** is a dev-only scratch page that ships with the
  production app.
- **`.agents/`** is an empty tracked-looking directory at the repo root.

## Design gaps

Found during the design pass on 2026-07-28 and deferred because each is a global decision,
not a local fix. Full context in [`editor-architecture.md`](./editor-architecture.md).

- The reading column runs to a ~90-character measure. Tightening it needs a `max-w-[70ch]`
  prose wrapper that figure and table blocks opt out of, so it cannot be a blanket change.
- Controls are 32px tall (`h-8`) app-wide, below the 44px touch-target guidance. Changing
  it is a whole-app scale decision.
- The fixed account chip in the root `layout.tsx` floats over content on **every** route.
  The reader compensates with padding; the shell itself was not restructured.

## Smaller follow-ups

- **Quote-only citations are dropped silently.** `fromWireMessage()` discards a persisted
  citation carrying neither a chunk id nor a title/url, because the UI has no way to render
  one. Correct today — it prevents a blank source row — but there is no telemetry or
  warning if it ever starts happening in volume.
- **`prompts.json` still contains `persona_prefix` keys that nothing reads.**
  `getSystemPrompt()` ignores them, so setting one produces silence rather than an error.
  See [`prompts-analysis.md`](./prompts-analysis.md).
- **Auth is opt-in per handler.** There is no `middleware.ts`; a new route under
  `src/app/api/` is public until its handler calls `requireAuthenticatedUserId()`. Nothing
  enforces this — worth a lint rule or a route test.
- **36 commits are unpushed** on `feat/chat-panel-resizer`, with no PR opened.

## Sequenced plan

1. Hand in the humora v2 structure (blocks 2 and 3).
2. Work through the stale issues and bugs above.
3. Run the module/submodule pass, adopting humora's boundary-enforcement mechanism.
4. Write the product-vision docs, and work from them.
