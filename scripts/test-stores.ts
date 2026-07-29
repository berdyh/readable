#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';

import { ensureSchema, pingPostgres, closePgPool } from '@/server/db';
import {
  ensureQdrantCollection,
  pingQdrant,
} from '@/server/vector';

loadEnv({ path: '.env.local' });
loadEnv();

async function main() {
  console.log('Pinging Postgres...');
  await pingPostgres();
  console.log('✓ Postgres reachable');

  console.log('Ensuring Postgres schema...');
  await ensureSchema();
  console.log('✓ Schema applied');

  console.log('Pinging Qdrant...');
  await pingQdrant();
  console.log('✓ Qdrant reachable');

  console.log('Ensuring Qdrant collection...');
  await ensureQdrantCollection();
  console.log('✓ Collection ready');

  console.log('All stores healthy.');
}

main()
  .catch((error) => {
    console.error('Store health check failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePgPool().catch(() => undefined);
  });
