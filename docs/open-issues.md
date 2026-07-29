# Open issues and next steps

Working state as of **2026-07-29**, `main`. `pnpm verify` green: 304 tests on `main`, 0 lint errors, 0 lint warnings. `pnpm test:api -- --live` is
**5/5** — health, qa, summarize, chat session, arXiv ingest.

This file is a **living checklist, not a record** — when an item is done, delete it rather
than marking it ✅, and put the durable explanation in the doc that owns that subject.
Anything frozen belongs in [`archive/`](./archive/).

## Next session — start here

Two items, both deliberately deferred rather than rushed.

### 1. Make local coding-agent detection self-correcting

`isAgentAuthenticated()` in `src/server/llm/providers/local-coding-agent.ts` decides whether
you are signed in by **reading and shape-checking the CLI's credential file**. It never asks
the CLI. That makes the whole feature pinned to the file formats of `codex-cli 0.145.0` and
`claude 2.1.220`.

That assumption has already broken once: `codex exec --ask-for-approval never` used to be
valid, the flag moved, and the resulting exit-2 was the original reason
`LLM_PROVIDER=coding-agent` failed for everyone.

What is genuinely portable today (verified by reading the code, not by running it elsewhere):

- No hardcoded paths — `os.homedir()`, and `CODEX_HOME` / `CLAUDE_CONFIG_DIR` are honoured.
- `PATH` discovery splits on `path.delimiter`, so it is not Unix-only.
- A missing or unparseable credential file returns `null`, so the agent renders **greyed out**
  rather than crashing. The failure mode is safe.

Where it will silently misreport on another machine:

- **macOS** — Claude Code may hold credentials in the Keychain rather than
  `~/.claude/.credentials.json`. You would be signed in and the picker would grey it out.
- **Any future format change** in either CLI — same false negative, no diagnostic.

**The fix:** probe rather than parse. Run the CLI's own status (or a trivial `exec`) once,
cache it for the session, and trust _its_ answer. That survives format changes by
construction, which file-shape checking cannot.

Related, from the same work and worth doing at the same time:

- The picker only reaches `/api/qa`. `/api/summarize` and `/api/editor/selection/*` still use
  the configured order, so "I picked Claude Code" is scoped to chat only.
- Credential refresh is write-through-to-nowhere: an agent refreshing its OAuth token mid-call
  writes into the temp `CODEX_HOME` we then delete. Correct, but it repeats the refresh
  round-trip every request, and would become a real problem if upstream ever rotated refresh
  tokens on use.
- `--tools ""` on Claude Code is a variadic flag — the empty string must stay last or it
  swallows the following argument.

### 2. Stop sending the whole paper to the model

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
