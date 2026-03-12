# Editor Migration Outcome

## Status

The legacy TipTap `ResearchEditor` subtree has been fully removed from `src/app/components/editor/`.

All routed editor behavior now runs through the block editor stack in `src/app/components/block-editor/`.

## Current command surface

Editor actions now flow through block-editor modules only:

- `BlockEditor.tsx` hosts the authoring surface used by routed pages.
- `commands.ts` defines slash command registry and execution metadata.
- `commandHandlers.ts` + `apiHandlers.ts` execute research commands against `/api/editor/*` endpoints.
- `intents.ts` is the single shared event contract for editor-driven AI intent actions.

## Removed legacy components

The following legacy files were removed as part of the migration:

- `src/app/components/editor/ResearchEditor.tsx`
- `src/app/components/editor/useResearchCommands.ts`
- `src/app/components/editor/EditorToolbar.tsx`
- `src/app/components/editor/SlashCommand.tsx`
- `src/app/components/editor/commands.ts`
- `src/app/components/editor/pdfImport.ts`
- `src/app/components/editor/intents.ts`

## Verification checklist

- No active imports of `ResearchEditor` remain in the app.
- No active imports from `src/app/components/editor/` remain.
- Chat/editor intent wiring now imports from `src/app/components/block-editor/intents.ts`.
