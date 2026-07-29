/**
 * Mints a real Clerk session JWT for automated testing.
 *
 * This is Clerk's sanctioned path for it: `POST /v1/sessions` is documented as
 * "intended only for testing" and is rejected on production instances, which is
 * exactly the guard rail you want — the same script cannot mint a session
 * against production by accident.
 *
 * Two things it is deliberately NOT:
 *
 * - Not a Clerk **API key** (`ak_…`). Those authenticate a machine.
 *   `requireAuthenticatedUserId()` reads `userId` from `auth()`, which only
 *   session tokens populate, so an API key produces the same 401 as an
 *   anonymous caller.
 * - Not an **M2M token**. Same reason, plus these flows are user-scoped by
 *   schema: `chat_sessions.user_id` is NOT NULL under a composite FK, and
 *   `persona_concepts` is keyed on `(user_id, concept)`. A machine identity has
 *   no user for those rows to belong to.
 *
 * Session tokens live ~60 seconds, so mint immediately before use rather than
 * caching one.
 */

const CLERK_API = "https://api.clerk.com/v1";

/** Email for the throwaway user this creates when none is supplied. */
const DEFAULT_TEST_EMAIL = "readable+agent-smoke@example.com";

interface ClerkError {
  errors?: Array<{ message?: string; long_message?: string; code?: string }>;
}

async function clerk<T>(
  secretKey: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${CLERK_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const payload = (await response.json()) as T & ClerkError;
  const failure = payload?.errors?.[0];
  if (!response.ok || failure) {
    const detail = failure?.long_message ?? failure?.message ?? `HTTP ${response.status}`;
    throw new Error(`Clerk ${init?.method ?? "GET"} ${path} failed: ${detail}`);
  }
  return payload;
}

async function resolveTestUserId(secretKey: string): Promise<string> {
  const explicit = process.env.TEST_CLERK_USER_ID?.trim();
  if (explicit) return explicit;

  const existing = await clerk<
    Array<{ id: string; email_addresses?: Array<{ email_address?: string }> }>
  >(secretKey, `/users?email_address=${encodeURIComponent(DEFAULT_TEST_EMAIL)}&limit=1`);
  if (existing.length > 0) return existing[0].id;

  const created = await clerk<{ id: string }>(secretKey, "/users", {
    method: "POST",
    body: {
      email_address: [DEFAULT_TEST_EMAIL],
      // Clerk requires a password or another factor; this user only ever exists
      // on a development instance and is never signed into interactively.
      password: `agent-smoke-${crypto.randomUUID()}`,
      skip_password_checks: true,
    },
  });
  return created.id;
}

export interface MintedSession {
  token: string;
  userId: string;
  sessionId: string;
  createdUser: boolean;
}

/**
 * Returns a session JWT usable as `Authorization: Bearer <token>`.
 *
 * Set `TEST_CLERK_USER_ID` to target a specific user; otherwise a dedicated
 * test user is found or created.
 */
export async function mintClerkSessionToken(): Promise<MintedSession> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error(
      "CLERK_SECRET_KEY is required to mint a test session token. It is already in .env.local for local runs.",
    );
  }
  if (secretKey.startsWith("sk_live")) {
    throw new Error(
      "Refusing to mint a session against a production Clerk instance. " +
        "POST /v1/sessions is testing-only and Clerk rejects it on live keys; " +
        "point CLERK_SECRET_KEY at a development instance (sk_test_…).",
    );
  }

  const before = process.env.TEST_CLERK_USER_ID?.trim();
  const userId = await resolveTestUserId(secretKey);
  const session = await clerk<{ id: string }>(secretKey, "/sessions", {
    method: "POST",
    body: { user_id: userId },
  });
  const { jwt } = await clerk<{ jwt: string }>(secretKey, `/sessions/${session.id}/tokens`, {
    method: "POST",
    body: {},
  });

  return { token: jwt, userId, sessionId: session.id, createdUser: !before };
}
