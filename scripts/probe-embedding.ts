#!/usr/bin/env tsx
/**
 * Probe the active embedding provider for its native vector dimension.
 * Useful when a remote model ignores the `dimensions` request parameter
 * and you need to know what value to set EMBEDDING_DIMENSIONS /
 * OPENROUTER_EMBEDDING_DIMENSIONS to.
 *
 *   pnpm tsx scripts/probe-embedding.ts
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });
loadDotenv();

import { probeEmbeddingDimensions } from '@/server/vector';

async function main() {
  try {
    const result = await probeEmbeddingDimensions();
    console.log(
      `[probe] provider=${result.providerId} model=${result.model} dimensions=${result.dimensions}`,
    );
    if (result.dimensions === 0) {
      console.error('[probe] Provider returned an empty vector. Check API key + model.');
      process.exit(1);
    }
  } catch (error) {
    console.error('[probe] Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
