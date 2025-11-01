# Component Cleanup Summary

## Safe to Delete (Confirmed Unused)

### High Priority - Delete Now

1. ✅ **ResearchEditor** - `src/app/components/editor/ResearchEditor.tsx`
   - Deprecated, not imported anywhere
   - ~532 lines
2. ✅ **SummaryPanel** - `src/app/components/summary/SummaryPanel.tsx`
   - Only used by deprecated ResearchEditor
3. ✅ **Old SlashCommand** - `src/app/components/editor/SlashCommand.tsx`
   - Replaced by `block-editor/SlashCommand.tsx`
   - Only used by deprecated ResearchEditor

4. ✅ **Old Editor Commands** - `src/app/components/editor/commands.ts`
   - Only exports types used by ResearchEditor

5. ✅ **Old Research Commands** - `src/app/components/editor/useResearchCommands.ts`
   - Only used by ResearchEditor

6. ✅ **PDF Import** - `src/app/components/editor/pdfImport.ts`
   - Only used by useResearchCommands (which is unused)

7. ✅ **Test Page** - `src/app/test-block-editor/page.tsx`
   - Optional: Development test page, can keep or delete

### Files to Keep (Still Used)

- ✅ **ChatPanel** - `src/app/components/chat/ChatPanel.tsx`
  - Used by ChatMessageBlock for inline chat
- ✅ **SlashCommandMenu** - `src/app/components/chat/SlashCommandMenu.tsx`
  - Used by ChatPanel for command suggestions
- ✅ **intents.ts** - `src/app/components/editor/intents.ts`
  - Used by ChatPanel
- ✅ **EditorToolbar** - `src/app/components/editor/EditorToolbar.tsx`
  - Used by ChatPanel

## Cleanup Commands

```bash
# Delete deprecated components
rm src/app/components/editor/ResearchEditor.tsx
rm src/app/components/summary/SummaryPanel.tsx
rm src/app/components/editor/SlashCommand.tsx
rm src/app/components/editor/commands.ts
rm src/app/components/editor/useResearchCommands.ts
rm src/app/components/editor/pdfImport.ts

# Optional: Remove test page
rm -rf src/app/test-block-editor
```

## Impact

- **Files Removed:** 6-7 files
- **Lines Removed:** ~2000+ lines of unused code
- **Directory Cleanup:** `editor/` directory reduced from 7 files to 2 files (intents.ts, EditorToolbar.tsx)

## After Cleanup Structure

```
src/app/components/
├── ai-chatbot/        ✅ Keep (all files used)
├── block-editor/      ✅ Keep (all files used)
├── chat/              ✅ Keep (ChatPanel still used, SlashCommandMenu needs check)
├── editor/            ⚠️ Keep only intents.ts and EditorToolbar.tsx
├── ingest/            ✅ Keep
├── pdf/               ✅ Keep
├── summary/           🔴 Delete (SummaryPanel.tsx)
└── workspace/         ✅ Keep
```

## Verification Checklist

Before deletion, verify:

- [ ] No imports of ResearchEditor in codebase
- [ ] No imports of SummaryPanel except in ResearchEditor
- [ ] No imports of old SlashCommand except in ResearchEditor
- [ ] ChatPanel still works (used by ChatMessageBlock)
- [ ] Test app still works after cleanup
