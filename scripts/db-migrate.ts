#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';

import { closePgPool, ensureSchema } from '@/server/db';

loadEnv({ path: '.env.local' });
loadEnv();

async function main() {
  console.log('Applying Postgres schema...');
  await ensureSchema();
  console.log('✓ Schema applied');
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePgPool().catch(() => undefined);
  });
