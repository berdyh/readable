#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';

import {
  ensureWeaviateSchema,
  getWeaviateClient,
  hybridPaperChunkSearch,
  verifyWeaviateConnection,
} from '@/server/weaviate';

loadEnv({ path: '.env.local' });
loadEnv();

async function main() {
  console.log('Connecting to Weaviate...');
  const client = getWeaviateClient();

  console.log('Verifying connectivity...');
  await verifyWeaviateConnection(client);
  console.log('✓ Health check passed');

  console.log('Ensuring schema...');
  await ensureWeaviateSchema(client);
  console.log('✓ Schema ensured');

  console.log('Running smoke hybrid query...');
  const result = await hybridPaperChunkSearch(
    {
      paperId: '__healthcheck__',
      query: 'healthcheck',
      limit: 1,
      pageWindow: 0,
    },
    client,
  );

  console.log(
    `✓ Hybrid query executed (hits: ${result.hits.length}, expanded: ${result.expandedWindow.length})`,
  );

  console.log('Weaviate connection and schema check complete.');
}

main().catch((error) => {
  console.error('Weaviate test failed:', error);
  process.exitCode = 1;
});
