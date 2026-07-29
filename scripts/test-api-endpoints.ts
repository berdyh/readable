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

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const LIVE_MODE = process.argv.includes("--live");
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN;

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

function authHeaders(): HeadersInit {
  return AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};
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

  if (!AUTH_TOKEN) {
    throw new Error("TEST_AUTH_TOKEN is required for --live Clerk-protected checks.");
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
