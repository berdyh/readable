# API Endpoints Analysis

This document analyzes all API endpoints in the application to identify which are actively used and which might be redundant or unused.

## Currently Used APIs ✅

### Core Functionality

1. **`/api/summarize`** - **USED**
   - Used in: `ReaderWorkspace.tsx`, `apiHandlers.ts`, `commandHandlers.ts`
   - Purpose: Generate structured summaries of research papers
   - Status: ✅ Active and functional

2. **`/api/qa`** - **USED**
   - Used in: `ChatPanel.tsx`, `ChatIntegration.tsx`
   - Purpose: Answer questions about papers with citations
   - Status: ✅ Active and functional

3. **`/api/ingest`** - **USED**
   - Used in: `IngestLanding.tsx`
   - Purpose: Ingest arXiv papers into the system
   - Status: ✅ Active and functional

4. **`/api/extract-research-paper`** - **USED**
   - Used in: `IngestLanding.tsx`
   - Purpose: Extract text, figures, tables from PDF files
   - Status: ✅ Active and functional

### Editor Selection APIs

5. **`/api/editor/selection/summary`** - **USED**
   - Used in: `useResearchCommands.ts`, `apiHandlers.ts`
   - Purpose: Summarize selected text from papers
   - Status: ✅ Active and functional

6. **`/api/editor/selection/figures`** - **USED**
   - Used in: `useResearchCommands.ts`, `apiHandlers.ts`
   - Purpose: Get figures related to selected text
   - Status: ✅ Active and functional

7. **`/api/editor/selection/citations`** - **USED**
   - Used in: `useResearchCommands.ts`, `apiHandlers.ts`
   - Purpose: Get citations related to selected text
   - Status: ✅ Active and functional

8. **`/api/editor/ingest/arxiv`** - **USED**
   - Used in: `useResearchCommands.ts`
   - Purpose: Ingest arXiv content inline in the editor
   - Status: ✅ Active and functional

### Chat APIs

9. **`/api/chat/history`** - **USED**
   - Used in: `ChatIntegration.tsx`
   - Purpose: Get, save, and delete chat history
   - Status: ✅ Active and functional

10. **`/api/chat/session`** - **USED**
    - Used in: `ChatIntegration.tsx`
    - Purpose: Create new chat sessions
    - Status: ✅ Active and functional

## Potentially Unused/Redundant APIs ⚠️

### Removed APIs

1. **`/api/editor/page`** - **REMOVED** ✅
   - **Status**: Removed - was never used in frontend
   - **Reason**: Placeholder implementation with no database persistence
   - **Action Taken**: Endpoint and route file deleted

### Unused APIs

1. **`/api/health`** - **KEPT** ✅
   - **Status**: Not called from frontend, but kept as requested
   - **Purpose**: Health check endpoint
   - **Analysis**:
     - Simple status check returning timestamp
     - Useful for monitoring/deployment checks
     - **Decision**: Kept for potential future use with monitoring tools or load balancers

## Summary

**Total APIs**: 11 (after cleanup)

- **Actively Used**: 10
- **Health Check**: 1 (kept for monitoring)
- **Removed**: 1 (`/api/editor/page`)

## Cleanup Actions Taken

1. ✅ **Removed `/api/editor/page` endpoint**
   - Deleted `src/app/api/editor/page/route.ts`
   - Removed empty directory

2. ✅ **Kept `/api/health` endpoint**
   - Retained as requested for potential monitoring use

3. ✅ **Created test script**
   - Added `scripts/test-api-endpoints.ts` to verify all endpoints

## Testing

Use the test script to verify all endpoints:

```bash
# Start dev server
pnpm dev

# In another terminal, run tests
pnpm exec tsx scripts/test-api-endpoints.ts
```

Note: Some endpoints require environment variables (OpenAI, Weaviate, etc.) to function fully. The test script will verify routing and error handling even without full configuration.
