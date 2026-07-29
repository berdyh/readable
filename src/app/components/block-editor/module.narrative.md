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
