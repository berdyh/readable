# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This worktree lives inside a bare-repo container. Project-level instructions also exist one level up
(`../CLAUDE.md`, `../AGENTS.md`) and cover worktree/branch management; this file is branch-local.

## Commands

```bash
pnpm install
docker compose up -d          # Postgres :5432 + Qdrant :6333
pnpm db:migrate               # apply src/server/db/schema.ts (idempotent; also runs on first request)
pnpm dev                      # http://localhost:3000

pnpm verify                   # lint + typecheck + test — the deterministic gate; no network/DB
pnpm test                     # vitest run (node env, src/**/*.test.ts)
pnpm vitest run src/server/llm/router.test.ts          # single file
pnpm vitest run -t "falls back"                        # single test by name
pnpm lint / pnpm lint:fix / pnpm typecheck / pnpm format
```

Live-service checks (never part of `pnpm verify`, they hit real services):

```bash
pnpm test:stores              # ping Postgres + schema + Qdrant + active embedding collection
pnpm embeddings:probe         # print the embedding provider's real vector dimension
pnpm test:api                 # offline route/auth/validation checks against a running dev server
TEST_AUTH_TOKEN=<clerk-session-token> pnpm test:api -- --live
pnpm setup                    # interactive provider chooser; writes LLM_* into .env.local
```

`pnpm dev` runs Next 16 with Turbopack. `canvas` is aliased to `src/shims/emptyCanvas.ts` in both the
Turbopack and webpack configs so `pdfjs-dist` doesn't pull in a native module — keep both aliases in
sync when touching `next.config.ts`.

## Architecture

Next.js App Router. Everything under `src/server/` is server-only business logic; `src/app/api/*/route.ts`
handlers are meant to stay thin (auth → validate → delegate → shape response). Client components may
import from `@/server/*` **only for types** (`qa/types`, `summarize/types`, `editor/types`) — never values.

### Request paths

- **Ingest** (`/api/ingest`, `/api/editor/ingest/arxiv` → `server/ingest/pipeline.ts`): arXiv metadata →
  prefer ar5iv HTML for structured sections/figures (`ar5iv.ts`) → fall back to PDF text via PDF.js
  (`pdf.ts`) → optional DeepSeek/RunPod OCR for image-only PDFs (`ocr.ts`). Records are upserted into
  Postgres and chunk embeddings written to Qdrant in one `replacePaperIngestData` transaction.
- **Summarize** (`/api/summarize` → `server/summarize/`): `context.ts` gathers sections from Postgres,
  `index.ts` prompts the LLM for structured JSON, then upserts the returned `concepts` into
  `persona_concepts` via `server/persona/record.ts`.
- **Q&A** (`/api/qa` → `server/qa/`): `context.ts` calls `server/search/hybrid.ts` (Qdrant vector search
  - Postgres `tsvector` full-text, fused with Reciprocal Rank Fusion, plus a page-window expansion),
    `index.ts` answers with a JSON schema that forces grounded `citations` + `concepts`.
- **Selection actions** (`/api/editor/selection/{summary,figures,citations}` → `server/editor/selection.ts`):
  the same retrieval machinery scoped to a text selection in the editor.
- **Chat** (`/api/chat/{session,history}` → `server/db/chat.ts`): persisted per-paper chat sessions;
  ownership is enforced with `ChatSessionOwnershipError`.

### LLM layer (`src/server/llm/`)

Two cooperating halves, documented in `src/server/llm/README.md`:

- `providers/` — one class per upstream API (openai, anthropic, gemini, openrouter) plus
  `local-coding-agent.ts`, which shells out to a local CLI (Codex, Claude Code) in an isolated temp
  `HOME`/`TMPDIR` with app secrets stripped from the environment. Because that also hides each
  agent's own credential, the invocation stages just that file into the sandbox (`CODEX_HOME` for
  Codex; `CLAUDE_CONFIG_DIR` holding only `claudeAiOauth` for Claude Code). There is no
  `CODEX_AUTH_FILE` env var in Codex itself — auth comes from `CODEX_HOME`.
  `GET /api/llm/local-agents` reports installed/authenticated per agent and drives the chat
  sidecar's agent picker; it is local-only and returns `enabled: false` when deployed.
- `routing/` — OpenClaw-pattern failover: env-key discovery (`READABLE_LIVE_*_KEY` → `*_API_KEYS` →
  `*_API_KEY` → `*_API_KEY_*`), CLI auth-file detection, per-profile cooldown ladder, and a
  `failover-classifier` that decides advance-vs-fail-fast (`auth_permanent` and `format` fail fast).
  Auth/cooldown state persists to `~/.readable/agents/<id>/`.

`router.ts` exposes `generateJson` / `generateText`. **Routing only engages when `LLM_ALLOWED_PROVIDERS`
is set**; otherwise calls go straight to `LLM_PROVIDER` (legacy fast path). `coding-agent` always uses the
local path regardless of stale API fallback settings.

Prompts and per-task model choices live in `src/server/llm-config/` (`prompts.json`, `models.json`,
accessed via `getSystemPrompt()` / `getModel()`) — never inline a prompt or model id at a call site.
Timeouts and base URLs live in `src/server/config/defaults.ts` behind `getTimeout()` / `getUrl()`, which
check env overrides first.

### Storage

- Postgres DDL is a template string in `src/server/db/schema.ts` (the runtime source of truth, applied by
  `ensureSchema()` on first request). `src/server/db/schema.sql` is a mirrored copy for reading — change
  both together. Tables: `papers`, `paper_chunks` (generated `tsvector` + GIN index), `paper_figures`,
  `paper_citations`, `persona_concepts`, `interactions`, chat sessions/messages.
- Qdrant collections are **per embedding provider+model**: `paper_chunks_<slug(provider+model)>`, each sized
  to that model's native dimension. Switching `EMBEDDING_PROVIDER`/model queries a different collection, so
  papers must be re-ingested after a switch. Setting `QDRANT_COLLECTION` pins a single stable name and
  opts out of that isolation. `EMBEDDING_PROVIDER=auto` uses OpenRouter when `OPENROUTER_API_KEY` is set,
  otherwise the built-in local hash embedder (384-dim).

### Client modules (`src/app/components/`)

Three sibling modules — editor, chat, reading surface. The legacy `components/editor/` tree is gone, as are
`components/ai-chatbot/`, `components/pdf/`, and `components/summary/` (folded into the modules below).

**`block-editor/` — the single editor implementation.**

- Content is a flat array of typed `Block`s (`types.ts`), rendered by `blocks/*`; only `TipTapBlock` uses
  TipTap, for rich-text paragraphs.
- Slash commands are declared in `commandRegistry.ts`, dispatched by `commands.ts`; commands with a
  `backendCommand` route through `apiHandlers.ts` to the `/api/editor/*` routes.
- Blocks produced by API calls carry `metadata.locked` and are read-only until explicitly unlocked — see
  `LOCKED_BLOCKS.md`. Slash commands inside a locked block insert their result _after_ it.
- Markdown round-tripping rules are in `MARKDOWN_FORMAT.md`; parsing lives in `parsers.ts` and
  `utils/markdown.ts`.

**`chat/` — the chat sidecar. Import only through `chat/index.ts`.** Internals are private, and the one
consumer outside the module is `BlockEditor.tsx`. The submodules are split by what they may touch, which is
the rule to check a new file against:

| Submodule             | May touch                           | Must not             |
| --------------------- | ----------------------------------- | -------------------- |
| `model/`              | data shapes, string/number rules    | React, fetch, DOM    |
| `api/`                | `fetch` to `/api/chat/*`, `/api/qa` | component state, DOM |
| `hooks/`              | client state, effects               | direct DOM styling   |
| `primitives/`         | props → markup                      | fetch, app state     |
| `sidecar/`, `inline/` | composition of the above            | new network calls    |

**`workspace/` — the paper reading surface.** `ReaderWorkspace` composes `ThreePassBar` + `BlockEditor` +
`SkillsPanel` + `workspace/pdf/PdfPanel`; the pass/paper/status hooks live beside it.

**The editor↔chat seam is two DOM CustomEvent contracts, both owned by the editor** — not props, not
context, because the trees are siblings:

- `block-editor/intents.ts` — editor → chat (`editor-ai-action`): summarize-selection, go-deeper, condense.
- `block-editor/navigation.ts` — chat → editor (`block-editor-navigate` + `-result`): reveal the block
  behind a citation, and answer whether it could. Request/response is correlated by `requestId`.
  Resolution is pure and unit-tested in `blockNavigation.ts` (quote → page → section ladder); the DOM half
  (scroll, focus, highlight) is `useBlockNavigation.ts`.

Add new cross-tree communication to these contracts rather than inventing a third channel.

### Auth

Clerk. There is no `middleware.ts` — protection is per-handler via `requireAuthenticatedUserId()` from
`src/server/auth/user.ts`, which throws `AuthenticationRequiredError`. Anonymous reads of public paper text
are intentionally allowed; summaries, chat, and skills are gated. Anonymous interactions are not recorded
in `persona_concepts`.

## Conventions and gotchas

- `lint-staged` runs ESLint on `.ts/.tsx` but Prettier only on css/md/json/yml, so TS formatting is not
  enforced on commit — the codebase is split between single- and double-quoted imports. Match the file
  you're editing rather than reformatting it.
- `docs/` is listed in `.gitignore` even though 15 files under it are already tracked; **new** files added
  to `docs/` will be silently untracked. `git add -f` them or fix the ignore rule.
- `docs/editor-architecture.md` still describes the removed `EditorWorkspace`/Tiptap-ribbon tree — treat
  its "Canonical helper locations" section as current and the component tree/state diagram as historical.
- **Chat wire types are owned by the server and derived on the client.** `src/server/chat/types.ts` is
  the canonical shape; `src/app/components/chat/model/types.ts` extends it rather than redeclaring it,
  and closes with `Assert<IsAssignable<…>>` type-level checks for the parts extension can't express. If
  you change a wire shape, those assertions are what tells you which client assumption broke — fix the
  client, don't relax the assertion. Note the client's `TrustDisplayMetadata` is deliberately wider than
  either wire trust shape (it renders `/api/qa` answers, persisted rows, and older rows); the assertions
  pin both wire shapes to it.
- **Two vitest projects, split by extension** (`vitest.workspace.ts`): `.test.ts` runs in `node`,
  `.test.tsx` runs in `jsdom` with Testing Library. Put a test in `.test.ts` unless it needs to
  render — the node project is much faster and covers everything that is pure logic. The globs
  cannot overlap, so a file never runs twice or lands in the wrong environment.
- Every module carries a `module.manifest.json`, a hand-written `module.narrative.md`, and a
  generated `AGENTS.md`. Edit the first two; `pnpm modules:generate` renders the third, and
  `pnpm verify` fails if it is stale. Module boundaries are enforced by `no-restricted-imports`
  zones in `eslint.config.mjs` — import from a module's index, not its internals.
