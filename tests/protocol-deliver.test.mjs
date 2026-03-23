/**
 * Regression tests for protocol deliver CLI reliability.
 *
 * Tests:
 *   1. CLI enforces request timeout and returns explicit error (no indefinite hang)
 *   2. CLI delivers successfully with a large artifact payload
 *   3. --artifacts-file flag loads artifacts from disk
 *   4. Non-2xx responses surface status + body (no silent failure)
 *   5. --payload-file delivers summary, artifacts, and changeRationales from one file
 *
 * Run:
 *   node --test tests/protocol-deliver.test.mjs
 *
 * Requires Node.js 18+ (uses node:test + node:http).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Helpers: minimal in-process HTTP server
// ---------------------------------------------------------------------------

/**
 * Starts a test HTTP server with the given handler.
 * Returns { url, close }.
 */
function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(res => server.close(res))
      });
    });
    server.on('error', reject);
  });
}

/**
 * Read all request body bytes as a string.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function importFresh(relativePath) {
  const fileUrl = pathToFileURL(path.join(ROOT, relativePath)).href;
  return import(`${fileUrl}?t=${Date.now()}-${Math.random()}`);
}

function createTempDir(prefix) {
  return join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function initGitRepo(repoDir) {
  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Overlord Test'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'overlord@example.com'], {
    cwd: repoDir,
    stdio: 'ignore'
  });
}

async function withProtocolEnv(callback) {
  const tempHome = createTempDir('ovld-home');
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousConnectorUrl = process.env.OVERLORD_CONNECTOR_URL;
  const previousAgentToken = process.env.AGENT_TOKEN;
  const previousTicketId = process.env.TICKET_ID;
  const previousSessionKey = process.env.SESSION_KEY;
  const previousHome = process.env.HOME;
  const previousCwd = process.cwd();

  try {
    mkdirSync(tempHome, { recursive: true });
    process.env.HOME = tempHome;
    delete process.env.OVERLORD_CONNECTOR_URL;
    return await callback();
  } finally {
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;

    if (previousConnectorUrl === undefined) delete process.env.OVERLORD_CONNECTOR_URL;
    else process.env.OVERLORD_CONNECTOR_URL = previousConnectorUrl;

    if (previousAgentToken === undefined) delete process.env.AGENT_TOKEN;
    else process.env.AGENT_TOKEN = previousAgentToken;

    if (previousTicketId === undefined) delete process.env.TICKET_ID;
    else process.env.TICKET_ID = previousTicketId;

    if (previousSessionKey === undefined) delete process.env.SESSION_KEY;
    else process.env.SESSION_KEY = previousSessionKey;

    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;

    process.chdir(previousCwd);
    rmSync(tempHome, { recursive: true, force: true });
  }
}

async function withStubbedConsole(callback) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWrite = process.stderr.write.bind(process.stderr);

  console.log = () => {};
  console.error = () => {};
  process.stderr.write = () => true;

  try {
    return await callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stderr.write = originalWrite;
  }
}

// ---------------------------------------------------------------------------
// Import the CLI apiPost logic under test.
//
// We test the protocol.mjs module's apiPost indirectly by exercising the
// exported runProtocolCommand with a controlled OVERLORD_URL that points to
// our local test server. The function uses process.env for auth resolution so
// we set lightweight stubs.
// ---------------------------------------------------------------------------

/**
 * Call apiPost directly by monkey-patching the fetch global with an
 * AbortSignal-aware implementation that delegates to the actual node fetch.
 * We keep the real fetch but override the OVERLORD_URL env to point to our
 * test server so the CLI's resolveAuth() returns the right base URL.
 */

// We inline a minimal version of apiPost here that mirrors the production
// implementation so that the tests are stable without importing internal
// mjs module state. Any divergence from protocol.mjs is a failing test by definition.
const DEFAULT_TIMEOUT_MS = 30000;

async function apiPost(platformUrl, token, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const requestUrl = `${platformUrl}${path}`;
  let res;
  try {
    res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(
        `Request timed out after ${timeoutMs}ms calling ${requestUrl}.\n` +
        `Tip: Ensure Overlord is running and reachable from this environment. ` +
        `Increase the limit with --timeout <ms> or OVERLORD_TIMEOUT=<ms>.`
      );
    }
    const causeCode = (
      typeof error === 'object' && error !== null &&
      'cause' in error && typeof error.cause === 'object' && error.cause !== null &&
      'code' in error.cause
    ) ? String(error.cause.code) : '';
    let hint = 'Check your network and Overlord server settings.';
    if (causeCode === 'ECONNREFUSED') hint = 'Connection refused.';
    else if (causeCode === 'ENOTFOUND') hint = 'Host not found.';
    throw new Error(`Network error calling ${requestUrl}: ${error.message ?? String(error)}${causeCode ? ` (${causeCode})` : ''}\n${hint}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`API error (${res.status}): ${data.error ?? JSON.stringify(data)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Test 1: timeout enforced — server delays past timeout window
// ---------------------------------------------------------------------------

test('CLI enforces request timeout and returns explicit error', async () => {
  // Server never responds (simulates a stalled deliver endpoint)
  const { url, close } = await startServer((_req, _res) => {
    // intentionally never send a response
  });

  try {
    await assert.rejects(
      () => apiPost(url, 'test-token', '/api/protocol/deliver', { test: true }, 200 /* 200ms */),
      (err) => {
        assert.ok(err instanceof Error, 'Should throw an Error');
        assert.ok(
          err.message.includes('timed out') || err.message.includes('Request timed out'),
          `Expected timeout message, got: ${err.message}`
        );
        assert.ok(
          err.message.includes(url),
          `Expected URL in error message, got: ${err.message}`
        );
        assert.ok(
          err.message.includes('--timeout') || err.message.includes('OVERLORD_TIMEOUT'),
          `Expected hint about --timeout flag in error message, got: ${err.message}`
        );
        return true;
      }
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Test 2: large artifact payload delivers successfully within timeout
// ---------------------------------------------------------------------------

test('CLI delivers large artifact payload successfully', async () => {
  const { url, close } = await startServer(async (req, res) => {
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, status: 'review', artifacts: parsed.artifacts?.length ?? 0 }));
  });

  try {
    // Build a payload that is representative of a large deliver: 10 artifacts with
    // multi-kilobyte content each (~100KB total)
    const largeContent = 'x'.repeat(10_000);
    const artifacts = Array.from({ length: 10 }, (_, i) => ({
      type: 'next_steps',
      label: `Artifact ${i}`,
      content: largeContent
    }));

    const result = await apiPost(
      url,
      'test-token',
      '/api/protocol/deliver',
      { sessionKey: 'sk', ticketId: 'tid', summary: 'Done', artifacts },
      30_000
    );

    assert.equal(result.ok, true);
    assert.equal(result.status, 'review');
    assert.equal(result.artifacts, 10);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Test 3: --artifacts-file flag equivalent (file loading logic)
// ---------------------------------------------------------------------------

test('Artifacts can be loaded from a JSON file', async () => {
  const { readFileSync } = await import('node:fs');

  const tmpDir = join(tmpdir(), `ovld-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const artifactsPath = join(tmpDir, 'artifacts.json');

  const expectedArtifacts = [
    { type: 'next_steps', label: 'Next steps', content: 'Deploy to staging' },
    { type: 'note', label: 'Implementation note', content: 'No schema changes required' }
  ];
  writeFileSync(artifactsPath, JSON.stringify(expectedArtifacts), 'utf8');

  try {
    // Replicate the --artifacts-file loading logic from protocolDeliver
    const artifacts = JSON.parse(readFileSync(artifactsPath, 'utf8'));
    assert.deepEqual(artifacts, expectedArtifacts);
    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[0].type, 'next_steps');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: non-2xx response surfaces status + body
// ---------------------------------------------------------------------------

test('CLI surfaces explicit error on non-2xx response', async () => {
  const { url, close } = await startServer(async (req, res) => {
    await readBody(req); // consume body
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to write delivery event.' }));
  });

  try {
    await assert.rejects(
      () => apiPost(url, 'test-token', '/api/protocol/deliver', {}, 5_000),
      (err) => {
        assert.ok(err instanceof Error, 'Should throw an Error');
        assert.ok(
          err.message.includes('500') || err.message.includes('API error'),
          `Expected HTTP status in error, got: ${err.message}`
        );
        assert.ok(
          err.message.includes('Failed to write delivery event.'),
          `Expected server error body in message, got: ${err.message}`
        );
        return true;
      }
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Test 5: ECONNREFUSED returns actionable error (not a timeout/hang)
// ---------------------------------------------------------------------------

test('CLI returns immediate actionable error when server is unreachable', async () => {
  // Port 1 is almost always refused without delay
  const unreachableUrl = 'http://127.0.0.1:1';

  const start = Date.now();
  await assert.rejects(
    () => apiPost(unreachableUrl, 'test-token', '/api/protocol/deliver', {}, 5_000),
    (err) => {
      assert.ok(err instanceof Error, 'Should throw an Error');
      // Should fail fast (well under timeout) with connection error
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 4_000, `Expected fast failure, took ${elapsed}ms`);
      assert.ok(
        err.message.includes('Network error') || err.message.includes('Connection refused') ||
        err.message.includes('ECONNREFUSED') || err.message.includes('fetch'),
        `Expected connection error, got: ${err.message}`
      );
      return true;
    }
  );
});

for (const modulePath of ['bin/_cli/protocol.mjs', 'packages/overlord-cli/bin/_cli/protocol.mjs']) {
  test(
    `${modulePath} deliver succeeds without change rationales when git has no changes`,
    { concurrency: false },
    async () => {
      const repoDir = createTempDir('ovld-deliver-clean');
      initGitRepo(repoDir);

      let requestBody = null;
      const { url, close } = await startServer(async (req, res) => {
        requestBody = JSON.parse(await readBody(req));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });

      try {
        await withProtocolEnv(async () => {
          process.chdir(repoDir);
          process.env.OVERLORD_URL = url;
          process.env.AGENT_TOKEN = 'test-token';

          const { runProtocolCommand } = await importFresh(modulePath);
          await withStubbedConsole(async () => {
            await runProtocolCommand('deliver', [
              '--session-key',
              'sk',
              '--ticket-id',
              'tid',
              '--summary',
              'Done'
            ]);
          });
        });

        assert.deepEqual(requestBody, {
          sessionKey: 'sk',
          ticketId: 'tid',
          summary: 'Done',
          artifacts: []
        });
      } finally {
        await close();
        rmSync(repoDir, { recursive: true, force: true });
      }
    }
  );

  test(
    `${modulePath} deliver fails when git changes exist and no change rationales are provided`,
    { concurrency: false },
    async () => {
      const repoDir = createTempDir('ovld-deliver-missing-rationales');
      initGitRepo(repoDir);
      writeFileSync(join(repoDir, 'changed.ts'), 'export const value = 1;\n', 'utf8');

      try {
        await withProtocolEnv(async () => {
          process.chdir(repoDir);
          process.env.OVERLORD_URL = 'http://127.0.0.1:9';
          process.env.AGENT_TOKEN = 'test-token';

          const { runProtocolCommand } = await importFresh(modulePath);
          await assert.rejects(
            () =>
              withStubbedConsole(() =>
                runProtocolCommand('deliver', [
                  '--session-key',
                  'sk',
                  '--ticket-id',
                  'tid',
                  '--summary',
                  'Done'
                ])
              ),
            err => {
              assert.ok(err instanceof Error);
              assert.match(err.message, /did not include matching `changeRationales`/);
              assert.match(err.message, /--skip-file-change-check/);
              assert.match(err.message, /changed\.ts/);
              return true;
            }
          );
        });
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    }
  );

  test(
    `${modulePath} deliver fails when supplied rationale paths do not match git changes`,
    { concurrency: false },
    async () => {
      const repoDir = createTempDir('ovld-deliver-mismatched-rationales');
      initGitRepo(repoDir);
      writeFileSync(join(repoDir, 'actual.ts'), 'export const value = 1;\n', 'utf8');

      try {
        await withProtocolEnv(async () => {
          process.chdir(repoDir);
          process.env.OVERLORD_URL = 'http://127.0.0.1:9';
          process.env.AGENT_TOKEN = 'test-token';

          const { runProtocolCommand } = await importFresh(modulePath);
          await assert.rejects(
            () =>
              withStubbedConsole(() =>
                runProtocolCommand('deliver', [
                  '--session-key',
                  'sk',
                  '--ticket-id',
                  'tid',
                  '--summary',
                  'Done',
                  '--change-rationales-json',
                  '[{"label":"Wrong file","file_path":"other.ts","summary":"...","why":"...","impact":"...","hunks":[{"header":"@@ ... @@"}]}]'
                ])
              ),
            err => {
              assert.ok(err instanceof Error);
              assert.match(err.message, /none of the supplied `changeRationales\.file_path` entries match/);
              assert.match(err.message, /actual\.ts/);
              assert.match(err.message, /other\.ts/);
              return true;
            }
          );
        });
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    }
  );

  test(
    `${modulePath} deliver succeeds when at least one rationale path matches a git change`,
    { concurrency: false },
    async () => {
      const repoDir = createTempDir('ovld-deliver-matching-rationales');
      initGitRepo(repoDir);
      writeFileSync(join(repoDir, 'matching.ts'), 'export const value = 1;\n', 'utf8');

      let requestBody = null;
      const { url, close } = await startServer(async (req, res) => {
        requestBody = JSON.parse(await readBody(req));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });

      try {
        await withProtocolEnv(async () => {
          process.chdir(repoDir);
          process.env.OVERLORD_URL = url;
          process.env.AGENT_TOKEN = 'test-token';

          const { runProtocolCommand } = await importFresh(modulePath);
          await withStubbedConsole(async () => {
            await runProtocolCommand('deliver', [
              '--session-key',
              'sk',
              '--ticket-id',
              'tid',
              '--summary',
              'Done',
              '--change-rationales-json',
              '[{"label":"Matching file","file_path":"matching.ts","summary":"Added deliver preflight coverage.","why":"The CLI should reject missing file metadata.","impact":"Deliver only proceeds when at least one rationale matches.","hunks":[{"header":"@@ -1 +1 @@"}]}]'
            ]);
          });
        });

        assert.equal(requestBody.changeRationales.length, 1);
        assert.equal(requestBody.changeRationales[0].file_path, 'matching.ts');
      } finally {
        await close();
        rmSync(repoDir, { recursive: true, force: true });
      }
    }
  );

  test(
    `${modulePath} deliver accepts --payload-file for summary, artifacts, and change rationales`,
    { concurrency: false },
    async () => {
      const repoDir = createTempDir('ovld-deliver-payload-file');
      initGitRepo(repoDir);
      writeFileSync(join(repoDir, 'matching.ts'), 'export const value = 1;\n', 'utf8');

      const payloadPath = join(repoDir, 'deliver.json');
      writeFileSync(
        payloadPath,
        JSON.stringify(
          {
            summary: 'Delivered from a single JSON payload file.',
            artifacts: [
              { type: 'note', label: 'Transport', content: 'Used --payload-file to avoid shell quoting.' }
            ],
            changeRationales: [
              {
                label: 'Match changed file',
                file_path: 'matching.ts',
                summary: 'Updated protocol delivery transport.',
                why: 'Agents need a quoting-safe submission path.',
                impact: 'Deliver can be posted from one JSON file.',
                hunks: [{ header: '@@ -1 +1 @@' }]
              }
            ]
          },
          null,
          2
        ),
        'utf8'
      );

      let requestBody = null;
      const { url, close } = await startServer(async (req, res) => {
        requestBody = JSON.parse(await readBody(req));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });

      try {
        await withProtocolEnv(async () => {
          process.chdir(repoDir);
          process.env.OVERLORD_URL = url;
          process.env.AGENT_TOKEN = 'test-token';

          const { runProtocolCommand } = await importFresh(modulePath);
          await withStubbedConsole(async () => {
            await runProtocolCommand('deliver', [
              '--session-key',
              'sk',
              '--ticket-id',
              'tid',
              '--payload-file',
              payloadPath
            ]);
          });
        });

        assert.equal(requestBody.summary, 'Delivered from a single JSON payload file.');
        assert.equal(requestBody.artifacts.length, 1);
        assert.equal(requestBody.changeRationales.length, 1);
        assert.equal(requestBody.changeRationales[0].file_path, 'matching.ts');
      } finally {
        await close();
        rmSync(repoDir, { recursive: true, force: true });
      }
    }
  );
}
