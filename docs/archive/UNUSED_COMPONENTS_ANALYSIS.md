# Unused Components and Files Analysis

## Overview

This analysis identifies unused and unnecessary components/files in the codebase, particularly legacy components from the old UI that have been replaced by the new block-based editor.

## Current State

The application has migrated from a TipTap-based `ResearchEditor` to a block-based `BlockEditor`. The main entry point for papers is:

- `src/app/papers/[paperId]/page.tsx` → Uses `ReaderWorkspace` → Uses `BlockEditor`

## Unused Components & Files

### 🔴 High Priority - Definitely Unused (Can be deleted)

#### 1. **ResearchEditor** (`src/app/components/editor/ResearchEditor.tsx`)

- **Status:** ⚠️ Marked as `@deprecated`
- **Usage:** Not imported anywhere in active code
- **Size:** ~532 lines
- **Dependencies:** Uses SummaryPanel, useResearchCommands
- **Note:** Migration path documented in file comments
- **Action:** ✅ Safe to delete

#### 2. **SummaryPanel** (`src/app/components/summary/SummaryPanel.tsx`)

- **Status:** Only used by deprecated ResearchEditor
- **Usage:** Imported only in `ResearchEditor.tsx`
- **Action:** ✅ Safe to delete (if ResearchEditor is removed)

#### 3. **EditorToolbar** (`src/app/components/editor/EditorToolbar.tsx`)

- **Status:** Only used in old UI components
- **Usage:**
  - Referenced in `ChatPanel.tsx` (imports `intents.ts`)
  - Only used by deprecated `ResearchEditor`
- **Action:** EditorToolbar seems unused; verify ChatPanel usage before deletion

#### 4. **Test Page** (`src/app/test-block-editor/page.tsx`)

- **Status:** Test/debug page
- **Usage:** Not linked from main navigation
- **Route:** `/test-block-editor`
- **Action:** ✅ Can be deleted (or kept for development if needed)

### 🟡 Medium Priority - Possibly Unused (Need Verification)

#### 5. **Old Editor Components** (`src/app/components/editor/`)

- **Files:**
  - `commands.ts` - Exports `ResearchEditorCommands` type (only used by ResearchEditor)
  - `SlashCommand.tsx` - **Old slash command system** (replaced by `block-editor/SlashCommand.tsx`)
  - `useResearchCommands.ts` - Old command hooks (only used by ResearchEditor)
  - `intents.ts` - Used by ChatPanel (which is still used) and EditorToolbar
  - `pdfImport.ts` - Used by useResearchCommands (which is only used by ResearchEditor)
  - `EditorToolbar.tsx` - Used by ChatPanel (which is still needed)
- **Status:**
  - `SlashCommand.tsx` - ✅ Replaced by `block-editor/SlashCommand.tsx`, can be deleted
  - `commands.ts`, `useResearchCommands.ts`, `pdfImport.ts` - Only used by ResearchEditor
  - `intents.ts`, `EditorToolbar.tsx` - Still needed by ChatPanel
- **Action:**
  - ✅ Delete: `SlashCommand.tsx`, `commands.ts`, `useResearchCommands.ts`, `pdfImport.ts`
  - ⚠️ Keep: `intents.ts`, `EditorToolbar.tsx` (used by ChatPanel)

#### 6. **ChatPanel** (`src/app/components/chat/ChatPanel.tsx`)

- **Status:** ✅ Still used by ChatMessageBlock
- **Usage:**
  - Imported and actively used in `ChatMessageBlock.tsx` (embedded chat in blocks)
  - Different from ChatIntegration (which is the side panel)
- **Action:** ✅ **Keep** - Still needed for inline chat blocks

#### 7. **SlashCommandMenu** (`src/app/components/chat/SlashCommandMenu.tsx`)

- **Status:** Old slash command menu
- **Usage:** Need to verify if used
- **Action:** ⚠️ Check if still needed

### 🟢 Low Priority - Likely Used (Keep)

#### 8. **AI Chatbot Components** (`src/app/components/ai-chatbot/`)

- **Status:** Used by `ChatIntegration.tsx` (new block editor chat)
- **Files:**
  - `conversation.tsx` ✅ Used
  - `message.tsx` ✅ Used
  - `prompt-input.tsx` ✅ Used
  - `reasoning.tsx` ✅ Used
  - `sources.tsx` ✅ Used
- **Action:** ✅ Keep - actively used

#### 9. **PDF Components** (`src/app/components/pdf/`)

- **Status:** Used by ReaderWorkspace
- **Files:**
  - `PdfViewerWithHighlights.tsx` ✅ Used
  - `FigureCallouts.tsx` ✅ Used
- **Action:** ✅ Keep - actively used

## Detailed Component Usage Analysis

### Currently Active Components

✅ **Active (Keep These):**

- `block-editor/` - ✅ All files actively used
- `workspace/ReaderWorkspace.tsx` - ✅ Main paper view
- `pdf/` - ✅ PDF viewing functionality
- `ingest/IngestLanding.tsx` - ✅ Landing page
- `ai-chatbot/` - ✅ Used by ChatIntegration

### Deprecated/Old UI Components

🔴 **Deprecated (Can Delete):**

- `editor/ResearchEditor.tsx` - Replaced by BlockEditor
- `summary/SummaryPanel.tsx` - Only used by ResearchEditor
- `test-block-editor/page.tsx` - Test page

⚠️ **Need Verification:**

- `editor/EditorToolbar.tsx` - Used by ChatPanel, check if ChatPanel is still needed
- `editor/commands.ts` - Only exports types used by ResearchEditor
- `editor/SlashCommand.tsx` - Old implementation
- `editor/useResearchCommands.ts` - Old hooks
- `editor/intents.ts` - Used by ChatPanel and EditorToolbar
- `editor/pdfImport.ts` - Used by useResearchCommands
- `chat/ChatPanel.tsx` - Check if still used by ChatMessageBlock
- `chat/SlashCommandMenu.tsx` - Check if still used

## Recommendations

### Immediate Actions

1. **Delete Deprecated Components:**

   ```bash
   # These are safe to delete
   rm src/app/components/editor/ResearchEditor.tsx
   rm src/app/components/summary/SummaryPanel.tsx
   rm src/app/test-block-editor/page.tsx  # Optional: keep for dev
   ```

2. **Verify and Clean Old Editor Directory:**
   - Check if `ChatPanel` still needs `intents.ts` and `EditorToolbar`
   - If ChatPanel is replaced by ChatIntegration, delete:
     - `editor/commands.ts`
     - `editor/SlashCommand.tsx`
     - `editor/useResearchCommands.ts`
     - `editor/intents.ts`
     - `editor/pdfImport.ts`
     - `editor/EditorToolbar.tsx`
     - `chat/ChatPanel.tsx`
     - `chat/SlashCommandMenu.tsx`

3. **Check ChatMessageBlock Usage:**
   - Verify if `ChatMessageBlock.tsx` actually uses `ChatPanel` or if it's dead code
   - If unused, remove the import

## File Count Impact

- **Current:** ~36 component files
- **After cleanup:** ~25-28 component files (estimated)
- **Removed:** ~8-11 files
- **Size reduction:** ~2000+ lines of unused code

## Migration Status

✅ **Completed:**

- BlockEditor fully replaces ResearchEditor
- ReaderWorkspace uses BlockEditor
- ChatIntegration replaces old chat system

🔴 **Legacy Code Still Present:**

- ResearchEditor (deprecated but not deleted)
- SummaryPanel (only used by deprecated component)
- Old editor utilities and commands
