import { withPgClient } from "./postgres";
import { READABLE_SCHEMA_SQL } from "./schema";

let migrationPromise: Promise<void> | undefined;

async function runMigration(): Promise<void> {
  await withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(READABLE_SCHEMA_SQL);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function ensureSchema(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runMigration().catch((error) => {
      migrationPromise = undefined;
      throw error;
    });
  }
  await migrationPromise;
}

export function resetSchemaPromise(): void {
  migrationPromise = undefined;
}
