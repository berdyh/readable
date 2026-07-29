# Open issues and next steps

Working state as of **2026-07-29**, `main`. `pnpm verify` green: 314 tests on `main`, 0 lint errors, 0 lint warnings. `pnpm test:api -- --live` is
**5/5** — health, qa, summarize, chat session, arXiv ingest.

The local coding-agent items that used to lead this file are done: auth detection now probes
the CLI itself (`codex login status` / `claude auth status`, sandboxed, cached, with the old
file shape-check kept as fallback), the chat picker's agent pin reaches `/summary` and
`/explain`, mid-call token refreshes are written back from the sandbox, and the `--tools ""`
ordering has a regression test. The durable explanations live as doc comments in
`src/server/llm/providers/local-coding-agent.ts`.

This file is a **living checklist, not a record** — when an item is done, delete it rather
than marking it ✅, and put the durable explanation in the doc that owns that subject.
Anything frozen belongs in [`archive/`](./archive/).

## Next session — start here

### Stop sending the whole paper to the model

`/api/summarize` currently assembles the entire paper into one prompt. That is wrong on cost,
on latency, and on quality — the relevant couple of kB is buried in ~24kB of noise.

**Measure before designing.** The one number that matters is not yet known: how much of the
prompt is paper text versus assembled scaffolding. `gemma-4-26b:free` summarised the raw 24kB
paper standalone in 47s, but `/api/summarize` still hit a 180s timeout with the same model —
so the real prompt is _substantially_ larger than the paper and nobody has measured the
difference. Get that number first; it should drive the design rather than assumptions.

Directions worth weighing once it is known, not before:

- **Retrieval-scoped summarisation** — `server.search` already does hybrid retrieval. Summarise
  the top-k chunks rather than everything.
- **Section-wise map-reduce** — summarise per section, cache those, reduce to a paper summary.
  Plays well with the existing `paper_chunks` section metadata.
- **Cheap-model triage** — a fast pass selects what the expensive pass reads.

Each has a different cost/quality trade-off, and the prompt-composition number decides which
is worth building.

## Verification gaps

### Two of the six chat flows are still unverified

`pnpm test:api -- --live` covers the authenticated **API** surface end to end and runs
unattended (it mints its own Clerk session token — `scripts/lib/clerk-test-session.ts`).
The jsdom project now covers the UI half of four flows:

- slash-command dispatch — `commands.test.ts`
- citation click → block scroll/reveal — `useBlockNavigation.test.tsx`
- chat tab deletion + confirmation — `ChatTabStrip.test.tsx`
- insert-answer into the document — exercised through the navigate/intent contracts

**Writing the first of those found a real bug**: the editor replied to a navigate
request inline, inside the synchronous dispatch, so the caller always subscribed too
late and a successfully revealed citation timed out into the red "unavailable" state.
Fixed by deferring the reply to a microtask. Worth remembering as evidence that this
seam needs rendered tests, not just review — both halves were individually correct and
only the ordering between them was wrong.

Still unverified:

- **sending and receiving a message**
- **session persistence across a reload**

Both need meaningful fetch orchestration rather than a render, so they are better done
alongside the ingestion work than bolted on separately.

## Smaller follow-ups

- **Selection summaries do not feed the persona graph.** `qa` and `summarize` both call
  `recordPersonaSignals()`; the selection path does not. Needs the selection summary schema to
  return `concepts` first, so it is a feature rather than a fix.
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
