#!/usr/bin/env node
/**
 * Executable fixture runner for connector harness-capability descriptors.
 *
 * A `supported` capability is only true if a fixture proves it, and a fixture is only
 * proof if it actually runs. This runner executes the six fixture kinds that are
 * meaningful for a connector adapter and returns a structured pass/fail result.
 *
 *   native-payload  Assert the shape of a RECORDED native harness payload: the fields the
 *                   adapter's binding/normalization depends on are present at the declared
 *                   paths. Pure; no process is started.
 *
 *   script-io       Run a shipped adapter script or rendered core script template in an
 *                   isolated sandbox (own HOME, TMPDIR, cwd, and a PATH whose only `ovld`
 *                   is a recording spy) with a recorded stdin, and assert exit status,
 *                   stdout, stderr, every file the script created inside the sandbox, and
 *                   every CLI invocation it attempted. This is how the mandatory
 *                   unbound-session negative test is executed.
 *
 *   source-guard    Assert that a repo file does or does not contain declared markers —
 *                   the mechanism for "this dangerous harness flag must stay unset".
 *
 *   normalized-event  Run a RECORDED native payload through the adapter's connector-owned
 *                   codec and the real pure normalizer, and assert the exact resulting
 *                   envelope. This is what makes an `observe.*` capability provable rather
 *                   than asserted: the fixture executes the shipped interpreter, so a codec
 *                   that stops producing the recorded envelope fails CI. It also carries a
 *                   `mustNotContain` list, which is how "no raw payload leaves the machine"
 *                   becomes an executable assertion instead of a promise.
 *
 *   decision-codec Run a recorded native decision payload through the connector-owned
 *                   declaration and the real pure request/response interpreter. Assert the
 *                   bounded redacted card plus exact allow, deny, and defer bytes.
 *
 *   mutation-window Validate recorded mutation evidence semantically. Classification is
 *                   derived from the available pre/post proof; a fixture cannot make a
 *                   `paired` claim true merely by writing that word into its own JSON.
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
  'decision-codec',
  'mutation-window'
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

/**
 * Execute a Phase-0 mutation-window proof. The referenced payload fixtures are
 * recorded native inputs, so this runner verifies the fields needed to safely
 * classify a connector without inventing a pairing that the harness has not
 * demonstrated. It deliberately does not read source files or invoke a hook.
 */
export function runMutationWindowFixture({ fixture, adapterDir, repoRoot }) {
  const failures = [];
  const allowedTopLevel = new Set([
    'fixtureVersion',
    'kind',
    'description',
    'classification',
    'reason',
    'preFixture',
    'postFixture',
    'proof'
  ]);
  const semanticFields = new Set([
    'session',
    'call',
    'workspace',
    'tool',
    'directPath',
    'outcome',
    'completion'
  ]);
  const proofKeys = new Set(['pre', 'post', 'mismatches']);

  for (const key of Object.keys(fixture)) {
    if (!allowedTopLevel.has(key)) failures.push(`unexpected mutation-window field: ${key}`);
  }
  if (typeof fixture.description !== 'string' || fixture.description.trim() === '') {
    failures.push('mutation-window fixture requires a non-empty description');
  }
  if (!['paired', 'post-only', 'unsupported'].includes(fixture.classification)) {
    failures.push('classification must be paired, post-only, or unsupported');
  }
  for (const key of Object.keys(fixture.proof ?? {})) {
    if (!proofKeys.has(key)) failures.push(`unexpected mutation-window proof field: ${key}`);
  }
  for (const [label, map] of [
    ['pre', fixture.proof?.pre],
    ['post', fixture.proof?.post]
  ]) {
    if (map === undefined) continue;
    if (map === null || typeof map !== 'object' || Array.isArray(map)) {
      failures.push(`${label} proof must be an object`);
      continue;
    }
    if (Object.keys(map).length === 0) {
      failures.push(`${label} proof must declare at least one semantic field`);
    }
    for (const [field, dotted] of Object.entries(map)) {
      if (!semanticFields.has(field)) {
        failures.push(`unexpected ${label} semantic field: ${field}`);
      }
      if (field === 'completion') {
        const valid =
          dotted &&
          typeof dotted === 'object' &&
          !Array.isArray(dotted) &&
          typeof dotted.path === 'string' &&
          dotted.path !== '' &&
          Object.hasOwn(dotted, 'equals') &&
          Object.keys(dotted).every(key => key === 'path' || key === 'equals');
        if (!valid) failures.push(`${label}.completion requires exactly path and equals`);
      } else if (typeof dotted !== 'string' || dotted === '') {
        failures.push(`${label}.${field} must be a non-empty dotted payload path`);
      }
    }
  }

  if (fixture.preFixture !== undefined && fixture.proof?.pre === undefined) {
    failures.push('preFixture requires a pre semantic proof');
  }
  if (fixture.postFixture !== undefined && fixture.proof?.post === undefined) {
    failures.push('postFixture requires a post semantic proof');
  }
  if (fixture.preFixture === undefined && fixture.proof?.pre !== undefined) {
    failures.push('pre semantic proof requires preFixture');
  }
  if (fixture.postFixture === undefined && fixture.proof?.post !== undefined) {
    failures.push('post semantic proof requires postFixture');
  }
  if (
    fixture.proof?.mismatches !== undefined &&
    (fixture.preFixture === undefined || fixture.postFixture === undefined)
  ) {
    failures.push('mismatch assertions require both preFixture and postFixture');
  }
  if (fixture.proof?.mismatches !== undefined && !Array.isArray(fixture.proof.mismatches)) {
    failures.push('mismatch assertions must be an array');
  }

  const readReferencedPayload = (label, ref) => {
    if (!ref) return null;
    if (typeof ref !== 'string' || !/^fixtures\/[A-Za-z0-9._-]+\.json$/.test(ref)) {
      failures.push(`${label} fixture must be an adapter-relative fixtures/*.json path`);
      return null;
    }
    let referenced;
    try {
      referenced = readJson(path.join(adapterDir, ref));
    } catch (error) {
      failures.push(`${label} fixture not readable: ${ref} (${error.message})`);
      return null;
    }
    if (referenced.payload === undefined) {
      failures.push(`${label} fixture has no recorded payload: ${ref}`);
      return null;
    }
    return { fixture: referenced, payload: referenced.payload };
  };
  const readSemanticValue = (label, payload, field, spec) => {
    if (!payload || spec === undefined || field === 'completion') return undefined;
    const value = resolvePath(payload, spec);
    if (typeof value !== 'string' || value.trim() === '') {
      failures.push(`${label} payload ${field} must resolve to a non-empty string at ${spec}`);
      return undefined;
    }
    return value;
  };
  const validateSemanticMap = (label, payload, map) => {
    const values = {};
    if (!map || typeof map !== 'object' || Array.isArray(map)) return values;
    for (const [field, spec] of Object.entries(map)) {
      if (field === 'completion') {
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
        const actual = resolvePath(payload, spec.path);
        if (actual !== spec.equals) {
          failures.push(
            `${label} completion mismatch at ${spec.path}: expected ${JSON.stringify(spec.equals)}, ` +
              `got ${JSON.stringify(actual)}`
          );
        }
      } else {
        values[field] = readSemanticValue(label, payload, field, spec);
      }
    }
    return values;
  };

  const preRecord = readReferencedPayload('pre', fixture.preFixture);
  const postRecord = readReferencedPayload('post', fixture.postFixture);
  const pre = preRecord?.payload ?? null;
  const post = postRecord?.payload ?? null;
  const preValues = validateSemanticMap('pre', pre, fixture.proof?.pre);
  const postValues = validateSemanticMap('post', post, fixture.proof?.post);

  const normalizedPostPaths = postRecord?.fixture?.expect?.payload?.paths;
  const hasNormalizedDirectPathShape =
    typeof fixture.proof?.post?.directPath === 'string' &&
    postRecord?.fixture?.kind === 'normalized-event' &&
    postRecord.fixture.expect?.kind === 'file.edited' &&
    Array.isArray(normalizedPostPaths) &&
    normalizedPostPaths.length > 0 &&
    normalizedPostPaths.every(entry => typeof entry === 'string' && entry.trim() !== '');
  let directPathEvidence = false;
  if (typeof fixture.proof?.post?.directPath === 'string' && !hasNormalizedDirectPathShape) {
    failures.push(
      'post.directPath requires a normalized-event fixture whose expected file.edited payload has paths'
    );
  } else if (hasNormalizedDirectPathShape) {
    const normalization = runNormalizedEventFixture({
      fixture: postRecord.fixture,
      repoRoot,
      adapterDir
    });
    if (!normalization.ok) {
      failures.push(
        ...normalization.failures.map(failure => `post.directPath normalization: ${failure}`)
      );
    } else {
      const rawDirectPath = postValues.directPath;
      const workspace = postValues.workspace;
      if (typeof rawDirectPath !== 'string' || typeof workspace !== 'string') {
        failures.push(
          'post.directPath evidence requires resolvable directPath and workspace values'
        );
      } else {
        const resolvedWorkspace = path.resolve(workspace);
        const resolvedDirectPath = path.isAbsolute(rawDirectPath)
          ? path.resolve(rawDirectPath)
          : path.resolve(resolvedWorkspace, rawDirectPath);
        const relativeDirectPath = path.relative(resolvedWorkspace, resolvedDirectPath);
        const canonicalDirectPath = relativeDirectPath.split(path.sep).join('/');
        const escapesWorkspace =
          canonicalDirectPath === '' ||
          canonicalDirectPath === '..' ||
          canonicalDirectPath.startsWith('../') ||
          path.isAbsolute(relativeDirectPath);
        if (
          escapesWorkspace ||
          normalizedPostPaths.length !== 1 ||
          normalizedPostPaths[0] !== canonicalDirectPath
        ) {
          failures.push(
            'post.directPath must resolve inside post.workspace and exactly match the sole ' +
              `codec-normalized file.edited path (raw ${JSON.stringify(rawDirectPath)}, ` +
              `normalized ${JSON.stringify(normalizedPostPaths)})`
          );
        } else {
          directPathEvidence = true;
        }
      }
    }
  }

  const pairedFields = ['session', 'call', 'workspace', 'tool', 'directPath'];
  const declaresStrictPair =
    Boolean(pre && post) &&
    pairedFields.every(field => typeof fixture.proof?.pre?.[field] === 'string') &&
    pairedFields.every(field => typeof fixture.proof?.post?.[field] === 'string') &&
    typeof fixture.proof?.post?.outcome === 'string' &&
    fixture.proof?.post?.completion !== undefined &&
    !(fixture.proof?.mismatches?.length > 0);
  const observedClassification = declaresStrictPair ? 'paired' : post ? 'post-only' : 'unsupported';

  if (fixture.classification !== observedClassification) {
    failures.push(
      `declared classification ${fixture.classification} does not match derived ${observedClassification}`
    );
  }

  if (observedClassification === 'paired') {
    for (const field of pairedFields) {
      if (preValues[field] !== postValues[field]) {
        failures.push(
          `${field} pair mismatch: ${JSON.stringify(preValues[field])} != ${JSON.stringify(postValues[field])}`
        );
      }
    }
  }

  if (observedClassification === 'post-only') {
    for (const field of ['session', 'workspace', 'tool']) {
      if (typeof fixture.proof?.post?.[field] !== 'string') {
        failures.push(`post-only proof requires post.${field}`);
      }
    }
    if (fixture.proof?.post?.completion === undefined) {
      failures.push('post-only proof requires post.completion with an exact native value');
    }
    if (pre) {
      const mismatches = fixture.proof?.mismatches;
      if (!Array.isArray(mismatches) || mismatches.length === 0) {
        failures.push('post-only evidence with both payloads must prove at least one mismatch');
      } else {
        for (const [index, mismatch] of mismatches.entries()) {
          const valid =
            mismatch &&
            typeof mismatch === 'object' &&
            !Array.isArray(mismatch) &&
            semanticFields.has(mismatch.field) &&
            mismatch.field !== 'completion' &&
            typeof mismatch.pre === 'string' &&
            mismatch.pre !== '' &&
            typeof mismatch.post === 'string' &&
            mismatch.post !== '' &&
            Object.keys(mismatch).every(key => ['field', 'pre', 'post'].includes(key));
          if (!valid) {
            failures.push(`mismatches[${index}] requires exactly field, pre, and post paths`);
            continue;
          }
          if (
            mismatch.pre !== fixture.proof?.pre?.[mismatch.field] ||
            mismatch.post !== fixture.proof?.post?.[mismatch.field]
          ) {
            failures.push(
              `mismatches[${index}] paths must equal the declared ${mismatch.field} semantic paths`
            );
            continue;
          }
          const before = resolvePath(pre, mismatch.pre);
          const after = resolvePath(post, mismatch.post);
          if (before === undefined || after === undefined) {
            failures.push(`mismatches[${index}] paths must both resolve`);
          } else if (JSON.stringify(before) === JSON.stringify(after)) {
            failures.push(
              `mismatches[${index}] did not differ: ${mismatch.pre} equals ${mismatch.post}`
            );
          }
        }
      }
    }
  }

  if (observedClassification === 'unsupported') {
    if (typeof fixture.reason !== 'string' || fixture.reason.trim() === '') {
      failures.push('unsupported evidence requires a non-empty reason');
    }
    if (fixture.postFixture !== undefined) {
      failures.push('unsupported evidence cannot reference a postFixture');
    }
  } else if (fixture.reason !== undefined) {
    failures.push('reason is only valid for unsupported mutation evidence');
  }

  return {
    ok: failures.length === 0,
    failures,
    observed: {
      classification: observedClassification,
      directPathEvidence: directPathEvidence ? 'direct' : 'unavailable'
    }
  };
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

  const adapterKey = fixture.adapterKey;
  if (adapterKey !== undefined && !/^[a-z][a-z0-9_-]*$/.test(adapterKey)) {
    return fail('script-io adapterKey must be a connector adapter key.');
  }

  let renderedScript = null;
  if (adapterKey !== undefined) {
    const source = readFileSync(scriptPath, 'utf8');
    const placeholder = '__OVERLORD_ADAPTER_KEY__';
    if (!source.includes(placeholder)) {
      return fail(`script-io template does not contain ${placeholder}: ${fixture.script}`);
    }
    renderedScript = source.replaceAll(placeholder, adapterKey);
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
    const spyStdin = path.join(sandbox, 'ovld-stdin.log');
    const spyPath = path.join(bin, 'ovld');
    writeFileSync(
      spyPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(spyLog)}\ncat >> ${JSON.stringify(spyStdin)}\nexit 0\n`,
      { mode: 0o755 }
    );

    const executablePath = renderedScript === null ? scriptPath : path.join(bin, 'callback.sh');
    if (renderedScript !== null) {
      writeFileSync(executablePath, renderedScript, { mode: 0o755 });
    }

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
    const result = spawnSync('/bin/bash', [executablePath], {
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
    let capturedStdin = '';
    try {
      capturedStdin = readFileSync(spyStdin, 'utf8');
    } catch {
      capturedStdin = '';
    }
    if (expected.cliInvocations !== undefined) {
      const actual = JSON.stringify(invocations);
      const wanted = JSON.stringify(expected.cliInvocations);
      if (actual !== wanted) failures.push(`cli invocations: expected ${wanted}, got ${actual}`);
    }
    if (expected.stdinForwarded !== undefined) {
      const forwarded = capturedStdin === stdin;
      if (forwarded !== expected.stdinForwarded) {
        failures.push(`stdin forwarded: expected ${expected.stdinForwarded}, got ${forwarded}`);
      }
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
        cliInvocations: invocations,
        cliStdin: capturedStdin,
        sandboxWrites: listFilesRecursively(home)
          .map(entry => `~/${entry}`)
          .concat(listFilesRecursively(temp).map(entry => `$TMPDIR/${entry}`))
          .concat(listFilesRecursively(work).map(entry => `./${entry}`))
          .sort()
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
    'decision-codec': runDecisionCodecFixture,
    'mutation-window': runMutationWindowFixture
  };
  const result = runners[fixture.kind]({
    fixture,
    repoRoot,
    adapterDir: path.dirname(path.dirname(fixturePath))
  });
  return { kind: fixture.kind, ...result };
}
