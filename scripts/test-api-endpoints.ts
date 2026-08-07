#!/usr/bin/env tsx
/**
 * API route verification harness.
 *
 * Default mode checks routing, validation, and Clerk protection without live
 * provider calls. Use --live only when Postgres, Qdrant, Clerk auth, and
 * external paper/LLM services are configured.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

import { mintClerkSessionToken } from "./lib/clerk-test-session";

// Only Next.js auto-loads .env.local; standalone tsx scripts do not. Without
// this, CLERK_SECRET_KEY is absent and the live pass cannot mint a token —
// which reads as a Clerk problem rather than a missing-env one.
loadEnv({ path: ".env.local" });
loadEnv();

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const LIVE_MODE = process.argv.includes("--live");

// Resolved in liveChecks(): an explicit TEST_AUTH_TOKEN if given, otherwise one
// minted from CLERK_SECRET_KEY. Session tokens expire in ~60s, so this is
// deliberately fetched at the last moment rather than at module load.
let authToken = process.env.TEST_AUTH_TOKEN;

interface TestCase {
  name: string;
  endpoint: string;
  method: "GET" | "POST" | "DELETE";
  expectedStatuses: number[];
  body?: unknown;
  formData?: FormData;
  note: string;
}

interface TestResult extends TestCase {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

/** When the current token was minted; undefined if the user supplied one. */
let mintedAt: number | undefined;

const TOKEN_MAX_AGE_MS = 40_000;

async function refreshMintedTokenIfStale(): Promise<void> {
  // Only refresh tokens we minted. An explicitly supplied TEST_AUTH_TOKEN is
  // the caller's to manage.
  if (mintedAt === undefined) return;
  if (Date.now() - mintedAt < TOKEN_MAX_AGE_MS) return;
  const minted = await mintClerkSessionToken();
  authToken = minted.token;
  mintedAt = Date.now();
}

function authHeaders(): HeadersInit {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

async function buildRequest(test: TestCase): Promise<RequestInit> {
  if (test.formData) {
    return {
      method: test.method,
      headers: authHeaders(),
      body: test.formData,
    };
  }

  return {
    method: test.method,
    headers: {
      ...authHeaders(),
      ...(test.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: test.body === undefined ? undefined : JSON.stringify(test.body),
  };
}

async function testEndpoint(test: TestCase): Promise<TestResult> {
  try {
    const response = await fetch(`${BASE_URL}${test.endpoint}`, await buildRequest(test));
    let error: string | undefined;

    if (!response.ok) {
      try {
        const data = (await response.json()) as { error?: string };
        error = data.error;
      } catch {
        error = `HTTP ${response.status}`;
      }
    }

    return {
      ...test,
      ok: test.expectedStatuses.includes(response.status),
      statusCode: response.status,
      error,
    };
  } catch (err) {
    return {
      ...test,
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

function offlineRouteChecks(): TestCase[] {
  return [
    {
      name: "health",
      endpoint: "/api/health",
      method: "GET",
      expectedStatuses: [200],
      note: "No dependencies.",
    },
    {
      name: "summarize validation",
      endpoint: "/api/summarize",
      method: "POST",
      body: {},
      expectedStatuses: [400],
      note: "Validates payload before auth/provider work.",
    },
    {
      name: "qa validation",
      endpoint: "/api/qa",
      method: "POST",
      body: {},
      expectedStatuses: [400],
      note: "Validates payload before auth/provider work.",
    },
    {
      name: "ingest auth gate",
      endpoint: "/api/ingest",
      method: "POST",
      body: {},
      expectedStatuses: [401],
      note: "Clerk-protected route should reject anonymous calls.",
    },
    {
      name: "extract auth gate",
      endpoint: "/api/extract-research-paper",
      method: "POST",
      expectedStatuses: [401],
      note: "Clerk-protected route should reject anonymous calls.",
    },
    {
      name: "selection summary validation",
      endpoint: "/api/editor/selection/summary",
      method: "POST",
      body: {},
      expectedStatuses: [400],
      note: "Validates payload before auth/provider work.",
    },
    {
      name: "selection figures validation",
      endpoint: "/api/editor/selection/figures",
      method: "POST",
      body: {},
      expectedStatuses: [400],
      note: "Validates payload before store work.",
    },
    {
      name: "selection citations validation",
      endpoint: "/api/editor/selection/citations",
      method: "POST",
      body: {},
      expectedStatuses: [400],
      note: "Validates payload before store work.",
    },
    {
      name: "editor arxiv ingest validation",
      endpoint: "/api/editor/ingest/arxiv",
      method: "POST",
      body: {},
      expectedStatuses: [400],
      note: "Validates payload before arXiv/store work.",
    },
    {
      name: "persona exposure validation",
      endpoint: "/api/persona/exposure",
      method: "POST",
      body: {},
      expectedStatuses: [400],
      note: "Validates payload before auth/ledger work.",
    },
    {
      name: "persona exposure auth gate",
      endpoint: "/api/persona/exposure",
      method: "POST",
      body: { paperId: "test-paper-id", concepts: [{ concept: "attention" }] },
      expectedStatuses: [401],
      note: "Clerk-protected route should reject anonymous calls.",
    },
    {
      name: "chat session auth gate",
      endpoint: "/api/chat/session",
      method: "POST",
      body: { paperId: "test-paper-id" },
      expectedStatuses: [401],
      note: "Clerk-protected route should reject anonymous calls.",
    },
    {
      name: "chat history auth gate",
      endpoint: "/api/chat/history?paperId=test-paper-id",
      method: "GET",
      expectedStatuses: [401],
      note: "Clerk-protected route should reject anonymous calls.",
    },
    {
      name: "chat history write auth gate",
      endpoint: "/api/chat/history",
      method: "POST",
      body: {
        sessionId: "test-session",
        paperId: "test-paper-id",
        message: {
          id: "test-msg",
          role: "user",
          content: "test message",
          createdAt: Date.now(),
        },
      },
      expectedStatuses: [401],
      note: "Clerk-protected route should reject anonymous calls.",
    },
  ];
}

async function liveChecks(): Promise<TestCase[]> {
  const paperId = process.env.TEST_LIVE_PAPER_ID;
  const arxivId = process.env.TEST_LIVE_ARXIV_ID ?? "2401.00001";

  if (!authToken) {
    // No token supplied — mint one. This is what makes the signed-in pass
    // runnable unattended: previously it needed a human to copy a JWT out of a
    // browser console within its 60-second lifetime.
    try {
      const minted = await mintClerkSessionToken();
      authToken = minted.token;
      mintedAt = Date.now();
      console.log(
        `Minted a Clerk session token for ${minted.userId}` +
          `${minted.createdUser ? " (test user created)" : ""}.\n`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not obtain a Clerk session token for --live checks.\n  ${reason}\n` +
          "  Set TEST_AUTH_TOKEN to a session JWT, or CLERK_SECRET_KEY to a development key so one can be minted.\n" +
          "  Note an API key (ak_…) or an M2M token will not work here — auth() only populates userId from a session token.",
      );
    }
  }
  if (!paperId) {
    throw new Error("TEST_LIVE_PAPER_ID is required for --live paper-scoped checks.");
  }

  const cases: TestCase[] = [
    {
      name: "health",
      endpoint: "/api/health",
      method: "GET",
      expectedStatuses: [200],
      note: "No dependencies.",
    },
    {
      name: "qa live",
      endpoint: "/api/qa",
      method: "POST",
      body: { paperId, question: "What problem is this paper solving?" },
      expectedStatuses: [200],
      note: "Requires Clerk, Postgres, Qdrant, and configured LLM path.",
    },
    {
      name: "summarize live",
      endpoint: "/api/summarize",
      method: "POST",
      body: { paperId },
      expectedStatuses: [200],
      note: "Requires Clerk, Postgres, and configured LLM path.",
    },
    {
      name: "chat session live",
      endpoint: "/api/chat/session",
      method: "POST",
      body: { paperId },
      expectedStatuses: [200],
      note: "Requires Clerk and Postgres chat tables.",
    },
    {
      name: "editor arxiv ingest live",
      endpoint: "/api/editor/ingest/arxiv",
      method: "POST",
      body: { target: arxivId },
      expectedStatuses: [200],
      note: "Requires arXiv, Postgres, Qdrant, and active embedder.",
    },
  ];

  if (process.env.TEST_PDF_PATH) {
    const pdfPath = process.env.TEST_PDF_PATH;
    const bytes = await fs.readFile(pdfPath);
    const formData = new FormData();
    formData.set("pdf", new File([bytes], path.basename(pdfPath), { type: "application/pdf" }));
    cases.push({
      name: "extract PDF live",
      endpoint: "/api/extract-research-paper",
      method: "POST",
      formData,
      expectedStatuses: [200],
      note: "Requires Clerk and a readable local PDF.",
    });
  }

  return cases;
}

function printResult(result: TestResult, index: number): void {
  const status = result.ok ? "PASS" : "FAIL";
  const expected = result.expectedStatuses.join("/");
  console.log(`${status} ${index + 1}. ${result.method} ${result.endpoint}`);
  console.log(`   Check: ${result.name}`);
  console.log(`   Expected: ${expected}`);
  console.log(`   Actual: ${result.statusCode ?? "network error"}`);
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
  console.log(`   Note: ${result.note}\n`);
}

async function runTests(): Promise<void> {
  const tests = LIVE_MODE ? await liveChecks() : offlineRouteChecks();
  console.log(`Testing API endpoints at ${BASE_URL}`);
  console.log(`Mode: ${LIVE_MODE ? "live external-service checks" : "offline route checks"}\n`);

  const results: TestResult[] = [];
  for (const test of tests) {
    // Clerk session tokens live ~60s and a live run takes minutes, so a token
    // minted once at the start expires partway through and later checks fail as
    // spurious 401s. Refresh before each request instead.
    await refreshMintedTokenIfStale();
    results.push(await testEndpoint(test));
  }

  results.forEach(printResult);

  const passCount = results.filter((result) => result.ok).length;
  const failCount = results.length - passCount;
  console.log(`Summary: ${passCount} passed, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Test runner failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
