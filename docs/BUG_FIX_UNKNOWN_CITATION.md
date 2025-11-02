# Bug Fix: Unknown Citation Reference

## Issue

**Location:** `src/server/editor/selection.ts` (lines 314-328)

**Problem:**
When `evidence.hits[0]` is undefined, the code created a bullet with `citationIds: ['unknown']` but never created the corresponding citation. The citation was only added inside the `if (fallbackChunk)` block, so when `fallbackChunk` was undefined, the bullet referenced a non-existent citation ID. Later, `ensureCitationForChunk('unknown', ...)` couldn't find this ID in the evidence, so no citation was created, resulting in broken references.

### Before Fix:

```typescript
if (!bullets.length) {
  const fallbackChunk = evidence.hits[0];
  const fallbackText =
    fallbackChunk?.text?.slice(0, 180) ??
    evidence.selection?.text ??
    "No inline summary available.";
  const chunkId = fallbackChunk?.chunkId ?? "unknown"; // ❌ Can be 'unknown'
  bullets.push({
    text: fallbackText.trim(),
    citationIds: [chunkId], // ❌ References 'unknown' when fallbackChunk is undefined
  });
  if (fallbackChunk) {
    citationMap.set(chunkId, createCitationFromChunk(fallbackChunk)); // ❌ Only creates citation if chunk exists
  }
  // ❌ If fallbackChunk is undefined, citationIds=['unknown'] but no citation exists
}
```

**Result:** Bullets with `citationIds: ['unknown']` but no corresponding citation in `citationMap`, causing broken references.

## Fix

**After Fix:**

```typescript
if (!bullets.length) {
  const fallbackChunk = evidence.hits[0];
  const fallbackText =
    fallbackChunk?.text?.slice(0, 180) ??
    evidence.selection?.text ??
    "No inline summary available.";

  if (fallbackChunk) {
    // Only create bullet with citation if we have a valid chunk
    const chunkId = fallbackChunk.chunkId;
    bullets.push({
      text: fallbackText.trim(),
      citationIds: [chunkId], // ✅ Only adds citationId when chunk exists
    });
    citationMap.set(chunkId, createCitationFromChunk(fallbackChunk)); // ✅ Citation always created
  } else {
    // No chunk available - create bullet without citation references
    bullets.push({
      text: fallbackText.trim(),
      citationIds: [], // ✅ Empty array instead of ['unknown']
    });
  }
}
```

**Result:**

- ✅ When `fallbackChunk` exists: Bullet created with valid citationId and corresponding citation
- ✅ When `fallbackChunk` is undefined: Bullet created with empty `citationIds` array (no broken references)

## Verification

### Test Cases

1. **With valid chunk:**
   - `evidence.hits[0]` exists → Bullet created with `citationIds: [chunkId]` and citation in map ✅

2. **Without valid chunk:**
   - `evidence.hits[0]` is undefined → Bullet created with `citationIds: []` (no broken references) ✅

### API Response Validation

```bash
# Verify no 'unknown' citations in bullets
curl -X POST http://localhost:3000/api/editor/selection/summary \
  -H "Content-Type: application/json" \
  -d '{"paperId":"test-paper-id","selection":{"text":"test"}}' | \
  jq '.callout.bullets[] | select(.citationIds[] == "unknown")'
```

**Expected:** Empty result (no bullets with 'unknown' citationIds)

## Impact

- ✅ **Fixes broken citation references** when no chunks are available
- ✅ **Prevents invalid citationIds** in bullet objects
- ✅ **Maintains data consistency** between bullets and citations
- ✅ **No breaking changes** - bullets without citations still display correctly

## Related Code

- `ensureCitationForChunk()` - Called for all citationIds in bullets (line 343)
- `createCitationFromChunk()` - Creates citations from chunks with proper validation
- `buildCalloutResult()` - Main function that constructs the callout response
