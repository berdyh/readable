Content is a flat array of typed `Block`s, not a document tree. Only
`TipTapBlock` runs TipTap, and only for rich-text paragraphs.

**This module owns the editor↔chat seam**, and it is two DOM CustomEvent contracts rather than
props or context, because the two trees are siblings:

- `intents.ts` — editor → chat (summarize-selection, go-deeper, condense).
- `navigation.ts` — chat → editor (reveal the block behind a citation, and answer whether it
  could), correlated by `requestId`.

Resolution is pure and unit-tested in `blockNavigation.ts`; the DOM half lives in
`useBlockNavigation.ts`. That split exists because the test environment is `node`, so
anything touching the DOM is untestable by construction. Add new cross-tree communication to
these two contracts rather than inventing a third channel.

**The store keeps one block set per source document, not one per editor.** The reading surface
swaps documents underneath a single `EditorProvider` — the summary artifact on the skim pass,
the paper HTML on read and deep — and each swap reparses with fresh block ids, so nothing can
be reconciled by identity. `documentKey` says which document arrived; `documentState.ts` holds
the pure adopt-or-restore decision (a key with reader edits is restored, anything else adopts
the incoming blocks), split out for the same reason `blockNavigation.ts` was. Every mutator
goes through the store's single `commit` path so a document cannot be edited without being
recorded — and a write that changes nothing is dropped, because TipTap emits an update the
moment it mounts.
