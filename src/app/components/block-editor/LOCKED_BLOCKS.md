# Locked Blocks Feature

## Overview

The block-based editor includes a **locked blocks** feature that prevents accidental editing of blocks generated from API calls (summaries, figures, citations, etc.). Locked blocks are read-only by default, but can be unlocked for manual editing.

## Behavior

### Locked State (Default for Generated Blocks)

- **Read-only**: Content cannot be edited directly
- **Slash commands work**: The "/" trigger works even in locked blocks
- **Slash command insertion**: Commands executed in locked blocks insert their results **after** the locked block, not within it
- **Visual indicator**: An edit icon appears on hover in the top-right corner of locked blocks
- **Toggle button**: An edit icon is shown in the block options menu when the block is focused

### Unlocked State

- **Fully editable**: Content can be modified normally
- **Slash commands**: Work as usual and can insert content into the block
- **Toggle button**: A lock icon is shown in the block options menu when the block is focused

## Implementation Details

### Block Metadata

Locked state is stored in block metadata:

```typescript
interface BlockMetadata {
  // ... other metadata fields
  locked?: boolean; // true = locked (read-only), false/undefined = unlocked (editable)
}
```

### TipTap Editor Integration

- When `locked: true`, the TipTap editor is set to `editable: false`
- The `onUpdate` callback is prevented from firing in locked blocks
- Keyboard events (except "/" for slash commands) are blocked in locked blocks
- The `setEditable()` method is used to toggle the editor's editable state when lock status changes

### Block Components

All block components (`TextBlock`, `HeadingBlock`, `ListBlock`, `TodoBlock`, `CodeBlock`, `QuoteBlock`, `CalloutBlock`) support the `isLocked` prop, which is passed through to `TipTapBlock`.

### UI Elements

1. **Edit Icon** (visible when locked): Shown in the block options menu and on hover in the top-right corner
2. **Lock Icon** (visible when unlocked and focused): Shown in the block options menu to re-lock the block
3. **Hover indicator**: Locked blocks show an edit icon in the top-right corner on hover

## Parser Integration

All parser functions in `parsers.ts` automatically mark generated blocks as locked:

- `parseSummaryToBlocks()` - All summary blocks
- `parseFiguresToBlocks()` - All figure blocks
- `parseCitationsToBlocks()` - All citation blocks
- `parseSelectionSummaryToBlocks()` - All selection summary blocks
- `parseTextSummaryToBlocks()` - All text summary blocks

## User Interaction

1. **To unlock a locked block**: Click the edit icon (pencil) in the block options menu or the hover indicator
2. **To lock an unlocked block**: Click the lock icon in the block options menu when the block is focused
3. **Using slash commands in locked blocks**: Type "/" and select a command - it will insert after the locked block

## Technical Notes

- Lock state persists with the block's metadata
- Locked blocks can still be deleted using Backspace/Delete on empty content
- Checkboxes in todo blocks are disabled when locked
- The slash command system is aware of locked blocks and adjusts insertion behavior accordingly
