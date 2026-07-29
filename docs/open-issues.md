# Open issues and next steps

Working state as of **2026-07-29**, branch `feat/chat-panel-resizer`. `pnpm verify` green:
31 test files, 255 tests, 0 lint errors, 0 lint warnings.

This file exists so the state of the work survives between sessions. It is a **living
checklist, not a record** — when an item is done, delete it from here rather than marking
it ✅, and put the durable explanation in the doc that owns that subject. Anything frozen
belongs in [`archive/`](./archive/).

## Verification gaps

### The authenticated surface has never been exercised

Still the largest residual risk in the tree, and it is now a **blocked** gap rather than an
unattempted one.

A smoke pass was attempted on 2026-07-29 against a local dev server with Postgres and
Qdrant up. What it established:

- The anonymous surface is verified. All 12 offline route checks pass, plus live
  `GET /api/health` and `POST /api/editor/ingest/arxiv` against real arXiv + Qdrant.
- The auth gate itself demonstrably rejects: `/api/qa`, `/api/summarize`, and
  `/api/chat/session` all returned 401 to a non-session bearer.

What it did **not** establish: anything behind sign-in. The token supplied was a Clerk
**API key** (`ak_…`), and `requireAuthenticatedUserId()` resolves a Clerk _session_, not a
bearer API key — so every authenticated check returned the same 401 an anonymous caller
gets.

These six flows remain unverified since the chat sidecar restructure:

- sending and receiving a message
- session persistence across a reload
- chat tab deletion and its confirmation step
- slash-command dispatch
- citation click → block scroll/reveal
- insert-answer into the document

**What would unblock it:** a real session JWT, not an API key. From a signed-in browser,
`await window.Clerk.session.getToken()` in the console yields one. Then:

```bash
docker compose up -d && pnpm db:migrate
PORT=3100 pnpm dev
TEST_BASE_URL=http://localhost:3100 \
TEST_AUTH_TOKEN=<session-jwt> \
TEST_LIVE_PAPER_ID=1706.03762v7 \
pnpm test:api -- --live
```

Note `TEST_BASE_URL`, not `API_BASE_URL` — passing the wrong one fails as twelve confusing
404s. And note the port: this worktree's directory is named `main`, so Docker Compose
derives the project name `main` and can collide with other projects on this machine. One
was already holding port 3000.

## Structural

### Oversized files — a readability job, not a correctness one

The 2026-07-28 note assumed a clean lint run over a large component was weak evidence
because "the file was too large for the compiler to analyze". That was half right: the
compiler really was silently skipping `Block.tsx`, but **file size was not the cause and
splitting would not have fixed it**.

The cause was one line — `await import("./apiHandlers")` inside a `useCallback`. A dynamic
import makes the React Compiler bail out on the whole component, so none of the 17
`react-hooks` rules ran on it. Measured by injecting the same violation
(`useEffect(() => { setState(true); }, [])`) into several files:

| Case                                                            | `set-state-in-effect` |
| --------------------------------------------------------------- | --------------------- |
| 7-line component                                                | fires                 |
| 7-line component + `await import()` in a callback               | **silent**            |
| 7-line component + `createRange`/`getSelection` DOM work        | fires                 |
| `Block.tsx` at 486 lines                                        | **silent**            |
| `Block.tsx` at 419 lines (drag extracted, import still dynamic) | **silent**            |
| `Block.tsx` with the import hoisted                             | fires                 |
| `PdfViewerWithHighlights.tsx`, 451 lines, no dynamic import     | fires                 |

The import is now static and `Block.tsx` reports clean — which finally means something. It
was the only `await import()` in application code, so no other component was ever affected,
and the large files below are all being analysed (or are server code the React rules never
applied to in the first place).

**So this is now purely a readability item, with no correctness argument behind it:**

| Lines | File                                                           |
| ----- | -------------------------------------------------------------- |
| 744   | `src/server/llm/providers/local-coding-agent.ts`               |
| 735   | `src/server/db/papers.ts`                                      |
| 699   | `src/server/ingest/pipeline.ts`                                |
| 688   | `src/server/summarize/index.ts`                                |
| 470   | `src/app/components/block-editor/parsers.ts`                   |
| 451   | `src/app/components/workspace/pdf/PdfViewerWithHighlights.tsx` |
| 442   | `src/server/editor/selection.ts`                               |

Worth doing eventually; not worth prioritising over anything that changes behaviour.

The lasting lesson is the general one: **a dynamic import inside a component silently
disables every react-hooks rule for that component.** If one is ever reintroduced, the file
stops being checked and nothing says so. Probing with a deliberate violation is the only
way to tell — consider it whenever a component's lint looks suspiciously clean.

## Smaller follow-ups

- **Selection summaries do not feed the persona graph.** `summarizeSelection()` used to
  accept a `userId` and ignore it. The dead parameter is gone, but the underlying gap is
  real: `qa` and `summarize` both call `recordPersonaSignals()` and the selection path does
  not. Wiring it up needs the selection summary schema to return `concepts` first, so it is
  a feature rather than a fix.
- **`docs/editor-architecture.md`** still describes the removed `EditorWorkspace`/Tiptap-ribbon
  tree. Its "Canonical helper locations" section is current; the component tree and state
  diagram are historical.
- **`docs/` is in `.gitignore`** even though files under it are tracked. New files added
  there are silently untracked — `git add -f` them or fix the ignore rule.

## Blocked on a decision

### Product-vision docs — deliberately not written

No roadmap, product-direction, or vision document has been written, and none should be
invented from the code. This is owned by the user.

## Sequenced plan

1. Get a Clerk session JWT and run the signed-in smoke pass.
2. Write the product-vision docs, and work from them.
