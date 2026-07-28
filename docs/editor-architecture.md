# Editor and reading-surface architecture

How the three client modules under `src/app/components/` divide the reading workspace, and why the
seams are where they are. For build/test commands and the server-side picture, see `CLAUDE.md`.

## The three modules

```
src/app/components/
├── block-editor/   the document surface — blocks, slash commands, locking
├── chat/           the chat sidecar — private internals, one public index
└── workspace/      the reading surface — composition, pass state, PDF
```

`ReaderWorkspace` (in `workspace/`) is the only place that composes all three. It renders
`ThreePassBar` + `BlockEditor` + `SkillsPanel`, with `workspace/pdf/PdfPanel` opening the PDF in a
modal. `BlockEditor` renders the chat launcher and docked panel via `chat/index.ts`.

There is no `components/editor/`, `components/ai-chatbot/`, `components/pdf/`, or
`components/summary/` — those trees were folded into the three modules above.

## `block-editor/` — the document surface

Content is a **flat array of typed blocks**, not a ProseMirror document. `types.ts` defines the block
union (`paragraph`, `heading_1..3`, list kinds, `code`, `quote`, `callout`, and the research-specific
`summary_section`, `figure`, `citation`, `chat_message`, `divider`) plus `BlockMetadata`. Each block
type has a renderer under `blocks/`. Only `TipTapBlock` embeds TipTap, and only for rich-text
paragraph editing — TipTap is a per-block detail, not the document model.

**Slash commands** are declared once in `commandRegistry.ts` and dispatched by `commands.ts`. A command
either mutates block state locally (`heading1`, `bullet`, `divider`, …) or carries a `backendCommand`,
in which case `apiHandlers.ts` calls the matching `/api/editor/*` route. Adding a command means adding a
registry entry, not touching the menu component.

**Locked blocks.** Anything the API generates is inserted with `metadata.locked = true` and is read-only
until explicitly unlocked. The non-obvious rule: a slash command typed inside a locked block inserts its
result *after* that block rather than into it, so generated output is never silently edited. Full
behaviour in `src/app/components/block-editor/LOCKED_BLOCKS.md`.

**Markdown** round-tripping rules are in `MARKDOWN_FORMAT.md`; the parsing lives in `parsers.ts` and
`utils/markdown.ts`.

## `chat/` — the sidecar

Everything outside the module imports from `chat/index.ts`. The internals are private; today the only
outside consumer is `BlockEditor.tsx`.

The submodules are split by **what each is allowed to touch**, which makes "where does this new file
go?" answerable without reading the whole module:

| Submodule | Owns | May touch | Must not touch |
| --- | --- | --- | --- |
| `model/` | message/tab shapes, slash catalogue, prompt builders, panel-width math | pure data and rules | React, `fetch`, the DOM |
| `api/` | `chatApi.ts` — the only chat network calls (`/api/chat/session`, `/api/chat/history`, `/api/qa`) | `fetch` | component state, the DOM |
| `hooks/` | all chat client state: `useChatSessions`, `useChatPanelWidth`, `useSlashCommandMenu`, `useEditorIntentPrompt` | state, effects, the api layer | direct DOM styling |
| `primitives/` | presentational pieces: answer card, conversation, message, prompt input, reasoning, sources | props → markup | `fetch`, app state |
| `sidecar/` | the docked panel: header, tab strip, transcript, composer, resize handle, auth gate, launcher | composing the above | new network calls |
| `inline/` | the ephemeral in-block panel and its slash menu | composing the above | new network calls |

`sidecar/` and `inline/` are two different products, not duplication: the sidecar is a persistent,
resizable, multi-session panel; the inline panel is an ephemeral prompt attached to one block.

The wire shapes are owned by the server. `chat/model/types.ts` derives its view model from
`@/server/chat/types` (what `/api/chat/history` validates) and `@/server/qa/types` (what `/api/qa`
returns) rather than redeclaring them, and ends with type-level assertions covering what the derivation
cannot express — that anything the UI can render is accepted by the history endpoint, and that both wire
trust shapes still fit `TrustDisplayMetadata`. When a wire shape changes, those assertions name the
client assumption that broke. Fix the client; don't relax the assertion.

`fromWireMessage()` is the wire→view boundary: it lifts `metadata.trust` to the top level and drops
citations the UI cannot render. That second job exists because the two shapes genuinely disagree — a
citation passes server validation if it carries *any* field, so a quote-only entry is valid on the wire
but has neither a chunk id to navigate with nor a title to display.

## The editor↔chat seam

The two trees are siblings, so they talk over **DOM CustomEvents**, not props or context. Both contracts
are owned by the editor — it defines what an intent and a navigable target are — and chat imports them.

```
block-editor/intents.ts       editor → chat    "editor-ai-action"
    summarize-selection | go-deeper | condense

block-editor/navigation.ts    chat   → editor  "block-editor-navigate"
                              editor → chat    "block-editor-navigate-result"
```

Navigation is request/response, correlated by a `requestId`, so the chat surface can tell the difference
between "revealed it" and "that citation points at nothing" and say so in the UI. Resolution runs a
matching ladder — exact/fuzzy quote, then page (±1), then section — and is kept **pure** in
`blockNavigation.ts` so it can be unit-tested; the vitest environment is `node`, not jsdom, so anything
touching the DOM is untestable by construction. The DOM half (scroll, focus, highlight) is isolated in
`useBlockNavigation.ts`.

**Add new cross-tree communication to these two contracts rather than inventing a third channel.** The
navigate contract exists because its event names and payloads were previously stringly-typed in two
files with nothing keeping them in sync.

## Theming

Themes are next-themes with `attribute="class"`, and Tailwind v4 defaults `dark:` to
`prefers-color-scheme` — those two disagree unless `globals.css` registers
`@custom-variant dark (&:where(.dark, .dark *))`. It does; **do not remove it**, or every `dark:`
utility in the app silently reverts to following the OS instead of the theme toggle. Keep it in sync
with the `attribute` prop if that ever changes.

Consequently, theme styling is `dark:` variants in markup. Do not thread an `isDarkMode` boolean through
props — that is the one pattern that can mismatch on first paint, and it was deliberately removed from
the PDF surface. The icon toggle in `ReaderWorkspace` ships both icons and hides one per variant so the
server and client render identical strings; read the comment there before changing it.

Palette: **zinc** for chrome and **emerald** for accent, with one radius hierarchy (`rounded-lg`
containers, `rounded-md` controls, `rounded-full` pills). `neutral-*` and `blue-*` were removed from this
tree; a new `neutral-` class is a sign of drift.

## Residual risk

### The authenticated surface has not been exercised end to end

The restructure was verified by typecheck, lint, unit tests, code review, and live browser checks of the
signed-out sidecar, the resizer geometry, both themes, mobile reflow, and the paper view. **Everything
behind Clerk sign-in was not verified live:**

- sending and receiving a message
- session persistence across a reload
- chat tab deletion and its confirmation step
- slash-command dispatch
- citation click → block scroll/reveal
- insert-answer into the document

Those rest on types, tests, and review alone. Given the size of the refactor, this is the main residual
risk in the client tree, and it is exactly the surface one signed-in smoke test would cover. The
authenticated harness already exists — see the bearer-token recipe in `README.md` and `API_TESTING.md` —
so this is a gap in coverage, not in tooling.

### Decomposition surfaces latent lint findings

Two `react-hooks/set-state-in-effect` errors appeared partway through the restructure. They were **not
introduced by it**: the rule had never fired on the 935-line component because it was too large for the
compiler to analyze. Splitting the file made pre-existing bugs visible for the first time. They were
fixed properly rather than suppressed.

The general lesson holds for the rest of the tree: a clean lint run over a large component is weak
evidence. Expect findings of this character whenever another oversized file is broken up, and budget for
fixing them rather than treating them as regressions introduced by the split.

## Known design gaps

Reported during the design pass and deliberately deferred — each is a global decision rather than a
local fix:

- The measure in the reading column runs to ~90 characters. Tightening it needs a `max-w-[70ch]` prose
  wrapper that figure and table blocks opt out of, so it cannot be a blanket change.
- Controls are 32px tall (`h-8`) app-wide, below the 44px touch-target guidance. Changing it is a
  whole-app scale decision.
- The fixed account chip in the root `layout.tsx` floats over content on **every** route. The reader
  compensates with padding; the shell itself was not restructured.
