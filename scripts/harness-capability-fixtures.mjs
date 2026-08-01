#!/usr/bin/env node
/**
 * Executable fixture runner for connector harness-capability descriptors.
 *
 * A `supported` capability is only true if a fixture proves it, and a fixture is only
 * proof if it actually runs. This runner executes the five fixture kinds that are
 * meaningful for a connector adapter and returns a structured pass/fail result.
 *
 *   native-payload  Assert the shape of a RECORDED native harness payload: the fields the
 *                   adapter's binding/normalization depends on are present at the declared
 *                   paths. Pure; no process is started.
 *
 *   script-io       Run a shipped adapter script in an isolated sandbox (own HOME, TMPDIR,
 *                   cwd, and a PATH whose only `ovld` is a recording spy) with a recorded
 *                   stdin, and assert exit status, stdout, stderr, every file the script
 *                   created inside the sandbox, and every CLI invocation it attempted.
 *                   This is how the mandatory unbound-session negative test is executed.
 *
 *   source-guard    Assert that a repo file does or does not contain declared markers —
 *                   the mechanism for "this dangerous harness flag must stay unset".
 *
 *   normalized-event  Run a RECORDED native payload through the adapter's connector-owned
 *                   codec and the real pure normalizer, and assert the exact resulting
 *                   envelope. This is what makes an `observe.*` capability provable rather
 *                   than claimed: the fixture executes the shipped interpreter, so a codec
 *                   that stops producing the recorded envelope fails CI. It also carries a
 *                   `mustNotContain` list, which is how "no raw payload leaves the machine"
 *                   becomes an executable assertion instead of a promise.
 *
 *   decision-codec Run a recorded native decision payload through the connector-owned
 *                   declaration and the real pure request/response interpreter. Assert the
 *                   bounded redacted card plus exact allow, deny, and defer bytes.
 *
 * Fixtures never reach the network: `script-io` runs with a PATH that contains no real
 * `ovld`, and the runner itself performs no I/O outside the repo and its sandbox.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const FIXTURE_KINDS = [
  'native-payload',
  'script-io',
  'source-guard',
  'normalized-event',
  'decision-codec'
];

function fail(message) {
  return { ok: false, failures: [message] };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/** Resolve a dotted path (`a.b.0.c`) against a recorded payload. */
function resolvePath(value, dotted) {
  let current = value;
  for (const segment of dotted.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = Array.isArray(current) ? current[Number(segment)] : current[segment];
  }
  return current;
}

function listFilesRecursively(root, prefix = '') {
  const entries = [];
  let dirents;
  try {
    dirents = readdirSync(root, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const entry of dirents) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      entries.push(...listFilesRecursively(absolute, relative));
    } else {
      entries.push(relative);
    }
  }
  return entries;
}

function runNativePayloadFixture({ fixture }) {
  const failures = [];
  const payload = fixture.payload;
  if (payload === undefined) {
    return fail('native-payload fixture must record a `payload`.');
  }
  for (const required of fixture.assert?.requiredPaths ?? []) {
    if (resolvePath(payload, required) === undefined) {
      failures.push(`required payload path missing: ${required}`);
    }
  }
  for (const [dotted, expected] of Object.entries(fixture.assert?.equals ?? {})) {
    const actual = resolvePath(payload, dotted);
    if (actual !== expected) {
      failures.push(
        `payload path ${dotted}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  }
  if (fixture.assert?.bindingField) {
    const value = resolvePath(payload, fixture.assert.bindingField);
    if (typeof value !== 'string' || value.trim() === '') {
      failures.push(`binding field ${fixture.assert.bindingField} is not a non-empty string`);
    }
  }
  return { ok: failures.length === 0, failures };
}

function runSourceGuardFixture({ fixture, repoRoot }) {
  const failures = [];
  const target = path.join(repoRoot, fixture.path);
  let contents;
  try {
    contents = readFileSync(target, 'utf8');
  } catch {
    return fail(`source-guard target not readable: ${fixture.path}`);
  }
  for (const marker of fixture.assert?.mustContain ?? []) {
    if (!contents.includes(marker))
      failures.push(`${fixture.path} must contain ${JSON.stringify(marker)}`);
  }
  for (const marker of fixture.assert?.mustNotContain ?? []) {
    if (contents.includes(marker))
      failures.push(`${fixture.path} must NOT contain ${JSON.stringify(marker)}`);
  }
  return { ok: failures.length === 0, failures };
}

function runScriptIoFixture({ fixture, repoRoot }) {
  const failures = [];
  const scriptPath = path.join(repoRoot, fixture.script);
  try {
    statSync(scriptPath);
  } catch {
    return fail(`script-io target not found: ${fixture.script}`);
  }

  const sandbox = mkdtempSync(path.join(tmpdir(), 'ovld-fixture-'));
  try {
    const home = path.join(sandbox, 'home');
    const work = path.join(sandbox, 'unrelated-project');
    const temp = path.join(sandbox, 'tmp');
    const bin = path.join(sandbox, 'bin');
    for (const dir of [home, work, temp, bin]) mkdirSync(dir, { recursive: true });

    // The only `ovld` on PATH is a spy: it records the invocation and exits 0 without
    // touching the network, so a fixture can assert exactly which CLI calls a script
    // attempts from an unbound session.
    const spyLog = path.join(sandbox, 'ovld-invocations.log');
    const spyPath = path.join(bin, 'ovld');
    writeFileSync(
      spyPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(spyLog)}\nexit 0\n`,
      { mode: 0o755 }
    );

    const env = {
      PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: temp,
      LANG: 'C',
      ...(fixture.env ?? {})
    };
    for (const [key, value] of Object.entries(fixture.env ?? {})) {
      if (value === null) delete env[key];
    }

    const stdin =
      typeof fixture.stdin === 'string' ? fixture.stdin : `${JSON.stringify(fixture.stdin ?? {})}`;
    const result = spawnSync('/bin/bash', [scriptPath], {
      cwd: work,
      env,
      input: stdin,
      encoding: 'utf8',
      timeout: fixture.timeoutMs ?? 20_000
    });

    const expected = fixture.expect ?? {};
    // EPIPE is the *expected* outcome for a script that exits before reading stdin, which is
    // precisely what a correctly gated hook does in an unbound session. Treating it as a
    // failure would make the runner reject the behavior the negative test exists to require.
    const isEarlyExitEpipe = result.error?.code === 'EPIPE' && result.status === 0;
    if (result.error && !isEarlyExitEpipe) {
      failures.push(`script failed to run: ${result.error.message}`);
    }
    if (expected.exitCode !== undefined && result.status !== expected.exitCode) {
      failures.push(`exit code: expected ${expected.exitCode}, got ${result.status}`);
    }
    if (expected.stdout !== undefined && result.stdout !== expected.stdout) {
      failures.push(
        `stdout: expected ${JSON.stringify(expected.stdout)}, got ${JSON.stringify(result.stdout)}`
      );
    }
    if (
      expected.stdoutContains !== undefined &&
      !String(result.stdout).includes(expected.stdoutContains)
    ) {
      failures.push(`stdout must contain ${JSON.stringify(expected.stdoutContains)}`);
    }
    if (expected.stderr !== undefined && result.stderr !== expected.stderr) {
      failures.push(
        `stderr: expected ${JSON.stringify(expected.stderr)}, got ${JSON.stringify(result.stderr)}`
      );
    }
    if (
      expected.stderrContains !== undefined &&
      !String(result.stderr).includes(expected.stderrContains)
    ) {
      failures.push(`stderr must contain ${JSON.stringify(expected.stderrContains)}`);
    }

    let invocations = [];
    try {
      invocations = readFileSync(spyLog, 'utf8')
        .split('\n')
        .filter(line => line.trim() !== '');
    } catch {
      invocations = [];
    }
    if (expected.cliInvocations !== undefined) {
      const actual = JSON.stringify(invocations);
      const wanted = JSON.stringify(expected.cliInvocations);
      if (actual !== wanted) failures.push(`cli invocations: expected ${wanted}, got ${actual}`);
    }

    if (expected.sandboxWrites !== undefined) {
      const written = listFilesRecursively(home)
        .map(entry => `~/${entry}`)
        .concat(listFilesRecursively(temp).map(entry => `$TMPDIR/${entry}`))
        .concat(listFilesRecursively(work).map(entry => `./${entry}`))
        .sort();
      const wanted = [...expected.sandboxWrites].sort();
      if (JSON.stringify(written) !== JSON.stringify(wanted)) {
        failures.push(
          `sandbox writes: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(written)}`
        );
      }
    }

    return {
      ok: failures.length === 0,
      failures,
      observed: {
        exitCode: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        cliInvocations: invocations
      }
    };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Execute a recorded native payload through the shipped codec and normalizer.
 *
 * The interpreter is TypeScript in `packages/core`, so it runs under `tsx` in a subprocess
 * rather than being imported here — the alternative is depending on a built `dist/`, which
 * makes a CI gate pass or fail on whether someone remembered to rebuild.
 */
function runNormalizedEventFixture({ fixture, repoRoot, adapterDir }) {
  const failures = [];
  const codecPath = path.join(adapterDir, fixture.codec);
  try {
    statSync(codecPath);
  } catch {
    return fail(`normalized-event codec not found: ${fixture.codec}`);
  }

  const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const helper = path.join(repoRoot, 'scripts', 'agent-session-normalize.mts');
  const result = spawnSync(tsx, [helper], {
    cwd: repoRoot,
    input: JSON.stringify({
      codecPath,
      payload: fixture.payload,
      nativeEventName: fixture.nativeEventName ?? null,
      occurredAt: fixture.occurredAt ?? '2026-01-01T00:00:00.000Z'
    }),
    encoding: 'utf8',
    timeout: fixture.timeoutMs ?? 60_000
  });
  if (result.status !== 0) {
    return fail(
      `normalizer failed (exit ${result.status}): ${String(result.stderr).slice(0, 400)}`
    );
  }

  let actual;
  try {
    actual = JSON.parse(result.stdout);
  } catch {
    return fail(`normalizer produced unparseable output: ${String(result.stdout).slice(0, 200)}`);
  }

  if (fixture.expect !== undefined) {
    const expectedJson = JSON.stringify(fixture.expect, null, 2);
    const actualJson = JSON.stringify(actual, null, 2);
    if (actualJson !== expectedJson) {
      failures.push(
        `normalized envelope mismatch:\n  expected ${expectedJson}\n  actual   ${actualJson}`
      );
    }
  }

  // The privacy assertion. Recorded payloads deliberately carry file contents, transcript
  // paths, and credential-shaped strings; none of them may appear anywhere in the envelope.
  const rendered = JSON.stringify(actual ?? null);
  for (const needle of fixture.mustNotContain ?? []) {
    if (rendered.includes(needle)) failures.push(`envelope leaked ${JSON.stringify(needle)}`);
  }

  return { ok: failures.length === 0, failures, observed: actual };
}

/** Execute connector-owned request paths and exact response literals through the shipped core. */
function runDecisionCodecFixture({ fixture, repoRoot, adapterDir }) {
  const codecPath = path.join(adapterDir, fixture.codec);
  try {
    statSync(codecPath);
  } catch {
    return fail(`decision-codec spec not found: ${fixture.codec}`);
  }
  const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const helper = path.join(repoRoot, 'scripts', 'agent-session-decision.mts');
  const result = spawnSync(tsx, [helper], {
    cwd: repoRoot,
    input: JSON.stringify({ codecPath, payload: fixture.payload }),
    encoding: 'utf8',
    timeout: fixture.timeoutMs ?? 60_000
  });
  if (result.status !== 0) {
    return fail(
      `decision interpreter failed (exit ${result.status}): ${String(result.stderr).slice(0, 400)}`
    );
  }
  let actual;
  try {
    actual = JSON.parse(result.stdout);
  } catch {
    return fail(
      `decision interpreter produced unparseable output: ${String(result.stdout).slice(0, 200)}`
    );
  }
  const failures = [];
  if (JSON.stringify(actual) !== JSON.stringify(fixture.expect)) {
    failures.push(
      `decision codec mismatch:\n  expected ${JSON.stringify(fixture.expect, null, 2)}\n  actual   ${JSON.stringify(actual, null, 2)}`
    );
  }
  const rendered = JSON.stringify(actual);
  for (const needle of fixture.mustNotContain ?? []) {
    if (rendered.includes(needle)) failures.push(`decision card leaked ${JSON.stringify(needle)}`);
  }
  return { ok: failures.length === 0, failures, observed: actual };
}

/**
 * Run one fixture file.
 *
 * @param {{ fixturePath: string, repoRoot: string }} args
 * @returns {{ ok: boolean, failures: string[], kind?: string, observed?: unknown }}
 */
export function runFixture({ fixturePath, repoRoot }) {
  let fixture;
  try {
    fixture = readJson(fixturePath);
  } catch (error) {
    return fail(`fixture is not readable JSON: ${error.message}`);
  }
  if (fixture.fixtureVersion !== 1) {
    return fail('fixture must declare "fixtureVersion": 1');
  }
  if (!FIXTURE_KINDS.includes(fixture.kind)) {
    return fail(
      `unknown fixture kind: ${fixture.kind} (expected one of ${FIXTURE_KINDS.join(', ')})`
    );
  }

  const runners = {
    'native-payload': runNativePayloadFixture,
    'script-io': runScriptIoFixture,
    'source-guard': runSourceGuardFixture,
    'normalized-event': runNormalizedEventFixture,
    'decision-codec': runDecisionCodecFixture
  };
  const result = runners[fixture.kind]({
    fixture,
    repoRoot,
    adapterDir: path.dirname(path.dirname(fixturePath))
  });
  return { kind: fixture.kind, ...result };
}
