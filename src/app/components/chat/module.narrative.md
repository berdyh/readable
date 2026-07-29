Everything outside this directory imports from `index.ts`, and today exactly
one consumer does: `BlockEditor.tsx`. That is now enforced by the ESLint zone rules rather
than by convention.

The six children are split by _what they may touch_, which is the rule to check a new file
against — the table is in each child's own doc.
