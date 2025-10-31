# Plan: Notion-Style UI Recreation for Analysis & Research Papers

## Overview
Completely recreate the UI for inputting analysis/summary and displaying research papers using a Notion-like interface. This involves:
- Replacing the current TipTap-based editor with a Notion-style block-based editor
- Implementing "/" slash command system for tool calling (like Notion)
- Parsing text and graphs into "pages" in the Notion UI
- Connecting all backend tools to the UI

## Current State Analysis

### Existing Components
1. **ResearchEditor** (`src/app/components/editor/ResearchEditor.tsx`)
   - Uses TipTap editor with extensions
   - Has slash command system for research-specific commands
   - Currently displays summary in a separate panel

2. **SummaryPanel** (`src/app/components/summary/SummaryPanel.tsx`)
   - Displays structured summary notes
   - Supports text selection and section identification

3. **ChatPanel** (`src/app/components/chat/ChatPanel.tsx`)
   - Q&A interface with "/" commands
   - Already has some Notion-like slash command functionality

### Backend APIs Available
1. **`/api/summarize`** - Generates structured summaries
   - Returns: `SummaryResult` with sections, key_findings, figures
   
2. **`/api/qa`** - Answers questions about papers
   - Returns: `AnswerResult` with answer and citations

3. **`/api/editor/selection/summary`** - Summarizes selected text
   - Returns: Selection callout results

4. **`/api/editor/selection/figures`** - Fetches nearby figures

5. **`/api/editor/selection/citations`** - Fetches citations

6. **`/api/editor/ingest/arxiv`** - Ingests arXiv papers

### Notion Clone Architecture (from reference)
**Reference Repository**: [shreyasmanolkar/notion-browser-client](https://github.com/shreyasmanolkar/notion-browser-client)

This is a well-architected Notion clone built with:
- React + TypeScript
- ProseMirror + Tiptap for rich text editing
- Redux Toolkit for state management
- Modern design patterns and component structure

**Key Components**:
1. **Editor Component** - Main container managing blocks state
2. **Blocks Component** - Individual block renderer with:
   - Content-editable divs
   - Block types: text, heading, bullet_list, number_list, to_do_list
   - "/" slash command detection
   - Drag and drop reordering
   - Block options menu
3. **Chat/Sidebar Components** - Reference for panel design patterns

## Implementation Plan

### Phase 1: Architecture Setup & Foundation
**Goal**: Set up new Notion-style block system architecture

#### Task 1.1: Create Block Type Definitions
- **MCP Tool**: None (local code creation)
- **Files**: `src/app/components/notion-editor/types.ts`
- **Description**: Define TypeScript interfaces for:
  - `BlockType`: text, heading_1, heading_2, heading_3, bullet_list, number_list, to_do_list, summary_section, figure, citation, code, quote
  - `Block`: { id, type, content, metadata?, children? }
  - `EditorState`: { blocks, paperId, loading }

#### Task 1.2: Create Block Store/State Management
- **MCP Tool**: None (local code creation)
- **Files**: `src/app/components/notion-editor/store.ts`
- **Description**: 
  - Create React context for block state
  - Implement block CRUD operations
  - Implement drag-and-drop position tracking

### Phase 2: Core Block Components

#### Task 2.1: Create Base Block Component
- **MCP Tool**: `mcp_github_get_file_contents` (to analyze Notion clone's Blocks.jsx)
- **Files**: `src/app/components/notion-editor/Block.tsx`
- **Description**:
  - Render content-editable block
  - Handle "/" command detection
  - Implement block options menu (Add, Delete, Change Style)
  - Support drag-and-drop handles
  - Reference: Notion clone's `Blocks.jsx`

#### Task 2.2: Implement Block Renderers
- **MCP Tool**: `mcp_github_get_file_contents` (to get styling from Notion clone)
- **Files**: `src/app/components/notion-editor/blocks/`
  - `TextBlock.tsx`
  - `HeadingBlock.tsx`
  - `ListBlock.tsx` (bullet and numbered)
  - `TodoBlock.tsx`
  - `SummarySectionBlock.tsx` (new - for research summaries)
  - `FigureBlock.tsx` (new - for research paper figures)
  - `CitationBlock.tsx` (new - for citations)
- **Description**: Each block type has its own renderer with appropriate styling

### Phase 3: Slash Command System

#### Task 3.1: Create Slash Command Extension
- **MCP Tool**: `mcp_github_search_code` (search for slash command implementations)
- **Files**: `src/app/components/notion-editor/SlashCommand.tsx`
- **Description**:
  - Replace current TipTap slash command system
  - Implement inline "/" menu (similar to Notion)
  - Support keyboard navigation (arrow keys, Enter, Escape)
  - Reference current `SlashCommand.tsx` but adapt for block system

#### Task 3.2: Create Slash Command Registry
- **MCP Tool**: `mcp_deepwiki_ask_question` (ask about best practices for command patterns)
- **Files**: `src/app/components/notion-editor/commands.ts`
- **Description**:
  - Define all slash commands with categories:
    - **Text formatting**: `/heading1`, `/heading2`, `/heading3`, `/bullet`, `/number`, `/todo`, `/quote`, `/code`
    - **Research tools**: `/summary`, `/figure`, `/cite`, `/arxiv`, `/deeper`, `/explain`, `/compare`, `/eli5`, `/depth+`, `/depth-`
    - **Content**: `/page`, `/divider`, `/callout`
  - Each command maps to block creation or API call

#### Task 3.3: Implement Command Handlers
- **MCP Tool**: None (use existing backend API knowledge)
- **Files**: `src/app/components/notion-editor/commandHandlers.ts`
- **Description**:
  - `/summary` → Call `/api/editor/selection/summary` or `/api/summarize`
  - `/figure` → Call `/api/editor/selection/figures`
  - `/cite` → Call `/api/editor/selection/citations`
  - `/arxiv` → Call `/api/editor/ingest/arxiv`
  - `/explain`, `/compare`, `/eli5`, `/depth+`, `/depth-` → Call `/api/qa`
  - Formatting commands → Create appropriate block type

### Phase 4: Main Editor Component

#### Task 4.1: Create NotionEditor Component
- **MCP Tool**: `mcp_github_get_file_contents` (get Editor.jsx from Notion clone)
- **Files**: `src/app/components/notion-editor/NotionEditor.tsx`
- **Description**:
  - Main container component
  - Manages block state
  - Handles block operations (add, update, delete, reorder)
  - Integrates with backend APIs
  - Reference: Notion clone's `Editor.jsx` structure

#### Task 4.2: Integrate Summary Parsing
- **MCP Tool**: None (use existing SummaryResult type)
- **Files**: `src/app/components/notion-editor/parsers.ts`
- **Description**:
  - Parse `SummaryResult` from `/api/summarize` into blocks:
    - Each `SummarySection` → SummarySectionBlock
    - Each `SummaryKeyFinding` → TextBlock or CalloutBlock
    - Each `SummaryFigure` → FigureBlock
  - Preserve page anchors and metadata

#### Task 4.3: Integrate Research Paper Data
- **MCP Tool**: None (use existing API knowledge)
- **Files**: `src/app/components/notion-editor/integrations.ts`
- **Description**:
  - Fetch paper metadata on mount
  - Create initial blocks from summary if available
  - Handle real-time updates when paper is ingested
  - Store block state per paperId

### Phase 5: Graph/Figure Rendering

#### Task 5.1: Create Figure Block Component
- **MCP Tool**: None (local implementation)
- **Files**: `src/app/components/notion-editor/blocks/FigureBlock.tsx`
- **Description**:
  - Render figure image from URL or base64
  - Display caption and page anchor
  - Support click-to-expand modal
  - Link to PDF viewer at specific page

#### Task 5.2: Create Graph Parsing Utilities
- **MCP Tool**: None (local implementation)
- **Files**: `src/app/components/notion-editor/parsers.ts`
- **Description**:
  - Parse figure data from API responses
  - Convert to FigureBlock format
  - Handle image loading and error states

### Phase 6: Chat Integration

#### Task 6.1: Integrate Chat into Editor
- **MCP Tool**: None (adapt existing ChatPanel)
- **Files**: `src/app/components/notion-editor/ChatIntegration.tsx`
- **Description**:
  - Embed chat panel within editor (side panel or inline)
  - Connect chat responses to block creation
  - Support "/" commands in chat (already exists in ChatPanel)

#### Task 6.2: Connect Chat to Block System
- **MCP Tool**: None (local implementation)
- **Files**: Modify `src/app/components/chat/ChatPanel.tsx`
- **Description**:
  - When chat command creates content, insert as block
  - Support "Insert as block" action from chat responses
  - Maintain chat history per paper

### Phase 7: Replace Existing Editor

#### Task 7.1: Update ReaderWorkspace
- **MCP Tool**: None (local refactoring)
- **Files**: `src/app/components/workspace/ReaderWorkspace.tsx`
- **Description**:
  - Replace `ResearchEditor` with `NotionEditor`
  - Maintain same props interface where possible
  - Update summary integration
  - Keep PDF viewer integration

#### Task 7.2: Remove/Deprecate Old Editor
- **MCP Tool**: None (local cleanup)
- **Files**: 
  - Mark `ResearchEditor.tsx` as deprecated
  - Update imports across codebase
  - Keep TipTap extensions for now (may need for inline formatting)

### Phase 8: Styling & Polish

#### Task 8.1: Create Editor Styles
- **MCP Tool**: `mcp_github_get_file_contents` (get CSS from Notion clone)
- **Files**: `src/app/components/notion-editor/editor.module.css`
- **Description**:
  - Match Notion's visual design
  - Block hover states
  - Slash menu styling
  - Drag-and-drop indicators
  - Reference: Notion clone's `Editor.module.css` and `Blocks.module.css`

#### Task 8.2: Implement Dark Mode Support
- **MCP Tool**: None (use existing theme system)
- **Files**: Update block components
- **Description**:
  - Use next-themes (already in project)
  - Add dark mode variants for all blocks
  - Ensure contrast and readability

### Phase 9: Testing & Integration

#### Task 9.1: Test Block Operations
- **MCP Tool**: None (manual testing)
- **Files**: Test all block CRUD operations
- **Description**:
  - Create, update, delete blocks
  - Test drag-and-drop reordering
  - Test "/" commands
  - Test block style changes

#### Task 9.2: Test Backend Integration
- **MCP Tool**: None (test API calls)
- **Files**: Verify all API integrations
- **Description**:
  - Test summary parsing and block creation
  - Test figure fetching and rendering
  - Test citation insertion
  - Test Q&A integration
  - Test arXiv ingestion

#### Task 9.3: Test with Real Papers
- **MCP Tool**: None (end-to-end testing)
- **Files**: Integration tests
- **Description**:
  - Ingest real arXiv paper
  - Generate summary
  - Test all interactions
  - Verify data persistence

## MCP Tool Usage Summary

### GitHub MCP Tools
1. **`mcp_github_get_file_contents`** - Used to fetch:
   - Notion clone's `Editor.jsx`
   - Notion clone's `Blocks.jsx`
   - Notion clone's CSS files
   - Block options and styling patterns

2. **`mcp_github_search_code`** - Search for:
   - Slash command implementations
   - Block rendering patterns
   - State management approaches

### DeepWiki MCP Tools
1. **`mcp_deepwiki_ask_question`** - Ask about:
   - Best practices for block-based editors
   - Command pattern implementations
   - React content-editable best practices

### Local Development (No MCP)
- TypeScript type definitions
- React component creation
- API integration code
- State management
- Styling (using Tailwind CSS)

## File Structure

```
src/app/components/notion-editor/
├── types.ts                    # Block type definitions
├── store.ts                    # Block state management
├── NotionEditor.tsx            # Main editor component
├── Block.tsx                   # Base block component
├── SlashCommand.tsx            # Slash command system
├── commands.ts                 # Command registry
├── commandHandlers.ts          # Command execution logic
├── parsers.ts                  # Parse API responses to blocks
├── integrations.ts             # Backend API integration
├── editor.module.css           # Editor styles
├── blocks/
│   ├── TextBlock.tsx
│   ├── HeadingBlock.tsx
│   ├── ListBlock.tsx
│   ├── TodoBlock.tsx
│   ├── SummarySectionBlock.tsx
│   ├── FigureBlock.tsx
│   └── CitationBlock.tsx
└── ChatIntegration.tsx        # Chat panel integration
```

## Key Integration Points

1. **Summary API** → Parse `SummaryResult` into blocks
2. **Q&A API** → Insert answers as blocks or chat messages
3. **Figure API** → Create FigureBlock instances
4. **Citation API** → Create CitationBlock instances
5. **ArXiv Ingestion** → Trigger block creation from paper data

## Success Criteria

1. ✅ Editor supports all block types (text, headings, lists, summaries, figures, citations)
2. ✅ "/" slash command system works for all commands
3. ✅ Summaries are parsed and displayed as blocks
4. ✅ Figures are rendered in blocks with proper styling
5. ✅ Chat is integrated and can create blocks
6. ✅ Drag-and-drop reordering works
7. ✅ All backend APIs are connected
8. ✅ UI matches Notion's design aesthetic
9. ✅ Dark mode works correctly
10. ✅ Performance is acceptable (no lag on typing/editing)

## Clarifications from User

1. **Replacement**: Completely replace ResearchEditor (no feature flag needed)
2. **Block State**: Add block state persistence to backend (store block state per paper)
3. **TipTap**: Keep TipTap for inline formatting as done in Notion's UI
4. **Chat Integration**: 
   - Chat panel pops up on right corner (triggered by circular AI icon)
   - Inline chat via "/chat" command with outputs in a box separated by lines
5. **Priority Order**:
   1. Block system and basic editing
   2. Slash command integration  
   3. Backend API connections
   4. Figure/graph rendering
6. **Migration**: Replace directly on this branch (no feature flag)

## Migration Strategy

1. Implement new NotionEditor components on this branch
2. Test thoroughly with real papers
3. Replace ResearchEditor in ReaderWorkspace
4. Remove old ResearchEditor once stable

## Notes

- Keep TipTap for inline text formatting (bold, italic, links) within blocks
- Use React ContentEditable for block editing
- Implement virtual scrolling if performance becomes an issue
- Consider using Zustand or Jotai for state management if Context becomes too heavy
- Ensure accessibility (keyboard navigation, screen readers)

