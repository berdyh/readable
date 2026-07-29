import { Pool, type PoolClient, type PoolConfig } from "pg";

export interface PostgresEnvironmentConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  poolMax: number;
  statementTimeoutMs: number;
  idleTimeoutMs: number;
}

const DEFAULT_POOL_MAX = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 20_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const lower = value.trim().toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") {
    return true;
  }
  if (lower === "false" || lower === "0" || lower === "no") {
    return false;
  }
  return undefined;
}

export function getPostgresEnvironment(): PostgresEnvironmentConfig {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? undefined;

  const config: PostgresEnvironmentConfig = {
    connectionString,
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : undefined,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: parseBoolean(process.env.POSTGRES_SSL),
    poolMax: Number(process.env.POSTGRES_POOL_MAX ?? DEFAULT_POOL_MAX),
    statementTimeoutMs: Number(
      process.env.POSTGRES_STATEMENT_TIMEOUT_MS ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    ),
    idleTimeoutMs: Number(process.env.POSTGRES_IDLE_TIMEOUT_MS ?? DEFAULT_IDLE_TIMEOUT_MS),
  };

  if (!config.connectionString && !(config.host && config.database && config.user)) {
    throw new Error(
      "Postgres configuration is missing. Set DATABASE_URL or POSTGRES_HOST/POSTGRES_DB/POSTGRES_USER (and POSTGRES_PASSWORD).",
    );
  }

  return config;
}

function buildPoolConfig(env: PostgresEnvironmentConfig): PoolConfig {
  const ssl = env.ssl ? { rejectUnauthorized: false } : undefined;

  if (env.connectionString) {
    return {
      connectionString: env.connectionString,
      max: env.poolMax,
      idleTimeoutMillis: env.idleTimeoutMs,
      statement_timeout: env.statementTimeoutMs,
      ssl,
    };
  }

  return {
    host: env.host,
    port: env.port,
    database: env.database,
    user: env.user,
    password: env.password,
    max: env.poolMax,
    idleTimeoutMillis: env.idleTimeoutMs,
    statement_timeout: env.statementTimeoutMs,
    ssl,
  };
}

declare global {
  var __readablePgPool: Pool | undefined;
}

let poolSingleton: Pool | undefined;

export function getPgPool(): Pool {
  if (poolSingleton) {
    return poolSingleton;
  }

  if (typeof globalThis !== "undefined" && globalThis.__readablePgPool) {
    poolSingleton = globalThis.__readablePgPool;
    return poolSingleton;
  }

  const env = getPostgresEnvironment();
  const pool = new Pool(buildPoolConfig(env));

  pool.on("error", (error) => {
    console.error("[postgres] Idle client error", error);
  });

  if (typeof globalThis !== "undefined") {
    globalThis.__readablePgPool = pool;
  }

  poolSingleton = pool;
  return pool;
}

export async function withPgClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function pingPostgres(): Promise<void> {
  const pool = getPgPool();
  await pool.query("SELECT 1");
}

export async function closePgPool(): Promise<void> {
  if (poolSingleton) {
    const pool = poolSingleton;
    poolSingleton = undefined;
    if (typeof globalThis !== "undefined") {
      globalThis.__readablePgPool = undefined;
    }
    await pool.end();
  }
}
