#!/usr/bin/env tsx
/**
 * Test script to verify all API endpoints are properly configured
 * Tests basic connectivity and error handling
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

interface TestResult {
  endpoint: string;
  method: string;
  status: 'ok' | 'error' | 'missing-env';
  statusCode?: number;
  error?: string;
  note?: string;
}

const results: TestResult[] = [];

async function testEndpoint(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<TestResult> {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    const status = response.ok ? 'ok' : 'error';
    const statusCode = response.status;

    // Try to get error message if any
    let error: string | undefined;
    let note: string | undefined;

    if (!response.ok) {
      try {
        const data = (await response.json()) as { error?: string };
        error = data.error;
      } catch {
        error = `HTTP ${statusCode}`;
      }

      // Some errors are expected (e.g., missing required fields)
      if (statusCode === 400 || statusCode === 404) {
        note = 'Expected error (missing required data)';
      } else if (statusCode >= 500 && statusCode < 600) {
        note = 'Server error (may need environment variables or external services)';
      }
    }

    return {
      endpoint,
      method,
      status,
      statusCode,
      error,
      note,
    };
  } catch (err) {
    return {
      endpoint,
      method,
      status: 'error',
      error: err instanceof Error ? err.message : 'Network error',
      note: 'Server may not be running',
    };
  }
}

async function runTests() {
  console.log(`Testing API endpoints at ${BASE_URL}\n`);

  // 1. Health check
  console.log('1. Testing /api/health...');
  results.push(await testEndpoint('/api/health', 'GET'));

  // 2. Summarize (expects paperId)
  console.log('2. Testing /api/summarize...');
  results.push(
    await testEndpoint('/api/summarize', 'POST', {
      paperId: 'test-paper-id',
    }),
  );

  // 3. Q&A (expects paperId and question)
  console.log('3. Testing /api/qa...');
  results.push(
    await testEndpoint('/api/qa', 'POST', {
      paperId: 'test-paper-id',
      question: 'What is this paper about?',
    }),
  );

  // 4. Ingest (expects arxivId)
  console.log('4. Testing /api/ingest...');
  results.push(
    await testEndpoint('/api/ingest', 'POST', {
      arxivId: '2401.00001',
    }),
  );

  // 5. Extract research paper (expects PDF file - will fail without file)
  console.log('5. Testing /api/extract-research-paper...');
  results.push(await testEndpoint('/api/extract-research-paper', 'POST'));

  // 6. Editor selection summary
  console.log('6. Testing /api/editor/selection/summary...');
  results.push(
    await testEndpoint('/api/editor/selection/summary', 'POST', {
      paperId: 'test-paper-id',
      selection: { text: 'test selection' },
    }),
  );

  // 7. Editor selection figures
  console.log('7. Testing /api/editor/selection/figures...');
  results.push(
    await testEndpoint('/api/editor/selection/figures', 'POST', {
      paperId: 'test-paper-id',
      selection: { text: 'test selection' },
    }),
  );

  // 8. Editor selection citations
  console.log('8. Testing /api/editor/selection/citations...');
  results.push(
    await testEndpoint('/api/editor/selection/citations', 'POST', {
      paperId: 'test-paper-id',
      selection: { text: 'test selection' },
    }),
  );

  // 9. Editor ingest arxiv
  console.log('9. Testing /api/editor/ingest/arxiv...');
  results.push(
    await testEndpoint('/api/editor/ingest/arxiv', 'POST', {
      target: '2401.00001',
    }),
  );

  // 10. Chat session
  console.log('10. Testing /api/chat/session...');
  results.push(
    await testEndpoint('/api/chat/session', 'POST', {
      paperId: 'test-paper-id',
    }),
  );

  // 11. Chat history (GET)
  console.log('11. Testing /api/chat/history (GET)...');
  results.push(
    await testEndpoint('/api/chat/history?paperId=test-paper-id', 'GET'),
  );

  // 12. Chat history (POST)
  console.log('12. Testing /api/chat/history (POST)...');
  results.push(
    await testEndpoint('/api/chat/history', 'POST', {
      sessionId: 'test-session',
      paperId: 'test-paper-id',
      message: {
        id: 'test-msg',
        role: 'user',
        content: 'test message',
        createdAt: Date.now(),
      },
    }),
  );

  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('TEST RESULTS');
  console.log('='.repeat(80) + '\n');

  let okCount = 0;
  let errorCount = 0;
  let expectedErrorCount = 0;

  results.forEach((result, index) => {
    const icon =
      result.status === 'ok'
        ? '✅'
        : result.note?.includes('Expected')
        ? '⚠️'
        : '❌';
    console.log(
      `${icon} ${index + 1}. ${result.method} ${result.endpoint}`,
    );
    if (result.statusCode) {
      console.log(`   Status: ${result.statusCode}`);
    }
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    if (result.note) {
      console.log(`   Note: ${result.note}`);
    }

    if (result.status === 'ok') {
      okCount++;
    } else if (result.note?.includes('Expected')) {
      expectedErrorCount++;
    } else {
      errorCount++;
    }
    console.log();
  });

  console.log('='.repeat(80));
  console.log(`Summary: ${okCount} OK, ${expectedErrorCount} Expected Errors, ${errorCount} Errors`);
  console.log('='.repeat(80));

  // Exit with error code if there are unexpected errors
  if (errorCount > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});

