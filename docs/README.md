# Documentation

Maintained reference material for Readable. Everything listed here is expected to
match the code; if it does not, that is a bug in the doc — fix it.

Architecture and day-to-day commands live in `CLAUDE.md` at the repo root, and the
setup/quick-start in `README.md`.

## Living docs

| Doc | Covers |
| --- | --- |
| [`open-issues.md`](./open-issues.md) | **Start here between sessions.** Current working state, what is blocked on a decision, verification gaps, deferred design work, and the sequenced plan. A living checklist — delete items as they are done. |
| [`API_ANALYSIS.md`](./API_ANALYSIS.md) | Inventory of every `src/app/api/**/route.ts` handler: methods, which are behind Clerk, and the response invariants the selection-summary endpoint must uphold. |
| [`API_TESTING.md`](./API_TESTING.md) | How to run the offline (`pnpm test:api`) and live (`--live`) API harnesses, per-endpoint `curl` recipes, the HTTP error taxonomy, and the source-click accessibility checklist. |
| [`database-structure.md`](./database-structure.md) | The Postgres schema (all eight tables), the Qdrant per-provider collection scheme, the UUID v5 strategy that links the two stores, and the hybrid RRF retriever. |
| [`prompts-analysis.md`](./prompts-analysis.md) | Where prompts live (`src/server/llm-config/prompts.json`), the three prompt tasks, the accessor functions, and the shared truncation limits. |
| [`PRIVACY.md`](./PRIVACY.md) | What a self-hosted deployment persists, which external services it calls, how persona data is collected, and where routing-layer credentials are written on disk. |
| [`editor-architecture.md`](./editor-architecture.md) | How `block-editor/`, `chat/` and `workspace/` divide the reading surface: the block model, the chat module's submodule rules, the two DOM CustomEvent contracts between editor and chat, the theming constraints, and the residual risk left by the restructure. |

In-tree docs that sit next to the code they describe:

| Doc | Covers |
| --- | --- |
| `src/app/components/block-editor/LOCKED_BLOCKS.md` | The locked-block contract for API-generated blocks. |
| `src/app/components/block-editor/MARKDOWN_FORMAT.md` | Markdown round-tripping rules for blocks. |
| `src/server/llm/README.md` | Provider classes and the OpenClaw-pattern failover/routing layer. |
| `src/server/llm-config/README.md` | `prompts.json` / `models.json` and their accessors. |
| `src/server/config/README.md` | Timeouts and base URLs behind `getTimeout()` / `getUrl()`. |

## Archive

[`archive/`](./archive/) holds frozen point-in-time records — build logs, status
reports, verification runs, and a completed implementation plan. They are **not
maintained** and must not be treated as current guidance. See
[`archive/README.md`](./archive/README.md) for what each one recorded and when.
