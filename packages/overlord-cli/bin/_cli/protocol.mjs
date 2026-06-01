#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildAuthHeaders, getAuthStatus, resolveAuth } from './credentials.mjs';

/**
 * Parse simple CLI flags: --key value or --key=value
 * @param {string[]} args
 * @returns {Record<string, string | boolean>}
 */
function parseFlags(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        result[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          result[key] = args[i + 1];
          i++;
        } else {
          result[key] = true;
        }
      }
    }
  }
  return result;
}

export function resolveProtocolAgentIdentifier(flags = {}) {
  const explicitAgent = typeof flags.agent === 'string' ? flags.agent.trim() : '';
  if (explicitAgent) return explicitAgent;

  const envAgent = process.env.AGENT_IDENTIFIER?.trim();
  return envAgent || 'claude-code';
}

export function resolveProtocolTicketDelegate(
  flags = {},
  modelIdentifier = '',
  agentIdentifier = ''
) {
  const explicitDelegate = typeof flags.delegate === 'string' ? flags.delegate.trim() : '';
  if (explicitDelegate) return explicitDelegate;

  const resolvedModel = typeof modelIdentifier === 'string' ? modelIdentifier.trim() : '';
  if (resolvedModel) return resolvedModel;

  const resolvedAgent = String(agentIdentifier).trim();
  return resolvedAgent || null;
}

export function resolveProtocolModelIdentifier(flags = {}) {
  const explicitModel = typeof flags.model === 'string' ? flags.model.trim() : '';
  if (explicitModel) return explicitModel;

  const envModel =
    process.env.OVERLORD_MODEL_IDENTIFIER?.trim() ||
    process.env.MODEL_IDENTIFIER?.trim() ||
    process.env.AGENT_MODEL?.trim();
  return envModel || null;
}

async function resolveProtocolMetadata(flags = {}, base = {}) {
  const metadata = { ...base };

  if (flags['metadata-json']) {
    const parsed = parseJsonFlag('--metadata-json', flags['metadata-json']);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('--metadata-json must be a JSON object');
    }
    Object.assign(metadata, parsed);
  }

  const modelIdentifier = resolveProtocolModelIdentifier(flags);
  if (modelIdentifier) {
    metadata.model = modelIdentifier;
  }

  // Thread the originating execution request id (set by the runner via
  // OVERLORD_EXECUTION_REQUEST_ID, or an explicit flag) into attach metadata so
  // the server marks that exact request `launched` instead of falling back to
  // matching by objective.
  const executionRequestId =
    (typeof flags['execution-request-id'] === 'string'
      ? flags['execution-request-id'].trim()
      : '') || process.env.OVERLORD_EXECUTION_REQUEST_ID?.trim();
  if (executionRequestId) {
    metadata.executionRequestId = executionRequestId;
  }

  const snapshot = await resolveSnapshotContext(flags);
  if (snapshot) {
    metadata.snapshot = snapshot;
  }

  return metadata;
}

/**
 * Default request timeout in milliseconds. Overridable via --timeout flag or
 * OVERLORD_TIMEOUT env var. A bounded timeout prevents indefinite spinner hangs
 * in sandboxed runtimes where deliver requests can stall without a connection error.
 */
const DEFAULT_TIMEOUT_MS = 30000;

async function apiPost(
  platformUrl,
  token,
  localSecret,
  organizationId,
  path,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const requestUrl = `${platformUrl}${path}`;
  const requestStart = Date.now();
  let res;
  try {
    res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(token, localSecret, organizationId),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // AbortSignal.timeout() throws a DOMException with name 'TimeoutError'
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(
        `Request timed out after ${timeoutMs}ms calling ${requestUrl}.\n` +
          `Tip: Ensure Overlord is running and reachable from this environment. ` +
          `Increase the limit with --timeout <ms> or OVERLORD_TIMEOUT=<ms>.`
      );
    }

    const causeCode =
      typeof error === 'object' &&
      error !== null &&
      'cause' in error &&
      typeof error.cause === 'object' &&
      error.cause !== null &&
      'code' in error.cause
        ? String(error.cause.code)
        : '';

    let hint = 'Check your network and Overlord server settings.';
    if (causeCode === 'ECONNREFUSED') {
      hint =
        'Connection refused. Verify Overlord is running and OVERLORD_URL points to the correct port. If this environment is sandboxed or network-restricted, request permission escalation before retrying.';
    } else if (causeCode === 'ENOTFOUND') {
      hint =
        'Host not found. Verify OVERLORD_URL uses a valid hostname. If this environment is sandboxed or network-restricted, request permission escalation before retrying.';
    } else if (causeCode === 'ETIMEDOUT') {
      hint =
        'Connection timed out. Verify server availability and local firewall/VPN settings. If this environment is sandboxed or network-restricted, request permission escalation before retrying.';
    } else if (requestUrl.includes('localhost') || requestUrl.includes('127.0.0.1')) {
      hint =
        'Local server unreachable. Start Overlord (usually http://localhost:3000) or update OVERLORD_URL. If this environment is sandboxed or network-restricted, request permission escalation before retrying.';
    }

    throw new Error(
      `Network error calling ${requestUrl}: ${message}${causeCode ? ` (${causeCode})` : ''}\n${hint}`
    );
  }

  const durationMs = Date.now() - requestStart;
  process.stderr.write(`[protocol] ${path} → ${res.status} (${durationMs}ms)\n`);

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    throw new Error(
      `Authentication failed (401): ${data.error ?? 'Invalid or missing token.'}\n` +
        `IMPORTANT: Stop all work immediately. Your Overlord auth session is invalid, expired, or missing required scope.\n` +
        `First run \`ovld auth repair\` yourself.\n` +
        `If repair does not fix it, ask the user to sign in again with Overlord Desktop or \`ovld auth login\` if needed.\n` +
        `Then ask whether they would like to proceed without submitting updates to Overlord.`
    );
  }

  if (!res.ok) {
    throw new Error(`API error (${res.status}): ${data.error ?? JSON.stringify(data)}`);
  }

  return data;
}

async function uploadToSignedUrl(uploadUrl, bytes, contentType, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-upsert': 'false'
      },
      body: bytes,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`Upload timed out after ${timeoutMs}ms.`);
    }
    throw new Error(`Upload failed: ${message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${text || 'Unknown storage error.'}`);
  }
}

// ---------------------------------------------------------------------------
// Session file persistence — auto-resolve session key between CLI calls
// ---------------------------------------------------------------------------

function getSessionFilePath() {
  return path.join(os.tmpdir(), `.overlord-session-${Buffer.from(process.cwd()).toString('base64url')}`);
}

function persistSession(sessionKey, ticketId) {
  try {
    fs.writeFileSync(
      getSessionFilePath(),
      JSON.stringify({ sessionKey, ticketId, ts: Date.now() }),
      'utf8'
    );
  } catch { /* best-effort */ }
}

function readPersistedSession() {
  try {
    const raw = fs.readFileSync(getSessionFilePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data.sessionKey && data.ticketId) return data;
  } catch { /* missing or corrupt — ignore */ }
  return null;
}

/** Read SESSION_KEY and TICKET_ID from env if flags not provided */
function resolveSessionFlags(flags) {
  const sessionKey = String(flags['session-key'] ?? process.env.SESSION_KEY ?? '');
  const ticketId = String(flags['ticket-id'] ?? process.env.TICKET_ID ?? '');

  if (sessionKey && ticketId) return { sessionKey, ticketId };

  const persisted = readPersistedSession();
  if (persisted) {
    return {
      sessionKey: sessionKey || persisted.sessionKey,
      ticketId: ticketId || persisted.ticketId
    };
  }

  return { sessionKey, ticketId };
}

/** Resolve request timeout from --timeout flag or OVERLORD_TIMEOUT env var. */
function resolveTimeout(flags) {
  const raw = flags['timeout'] ?? process.env.OVERLORD_TIMEOUT;
  if (raw) {
    const ms = parseInt(String(raw), 10);
    if (!isNaN(ms) && ms > 0) return ms;
  }
  return DEFAULT_TIMEOUT_MS;
}

function resolveForHumanFlag(flags) {
  if (flags['for-human'] !== undefined) {
    const raw = flags['for-human'];
    if (raw === true) return true;
    if (raw === false) return false;
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === '' || normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    throw new Error('--for-human must be a boolean flag or one of true/false.');
  }

  if (flags['execution-target'] !== undefined) {
    return String(flags['execution-target']).trim().toLowerCase() === 'human';
  }

  return undefined;
}

function parseRepeatedCliFlags(args, name) {
  const result = [];
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) {
      result.push(args[i + 1]);
      i++;
      continue;
    }
    if (arg.startsWith(prefix)) {
      result.push(arg.slice(prefix.length));
    }
  }
  return result;
}

function requireFlag(flags, name, envAlias) {
  const value = flags[name] ?? (envAlias ? process.env[envAlias] : undefined);
  if (!value) {
    throw new Error(`--${name} is required (or set ${envAlias ?? name.toUpperCase()})`);
  }
  return String(value);
}

function parseOrganizationId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function organizationIdFromTicketId(ticketId) {
  const [organizationPart, _ticketSequencePart, ...rest] = String(ticketId ?? '')
    .trim()
    .split(':');
  if (rest.length > 0) return null;
  return parseOrganizationId(organizationPart);
}

function resolveOrganizationIdHint(flags, ticketId) {
  return organizationIdFromTicketId(ticketId) ?? parseOrganizationId(flags['organization-id']);
}

async function resolveProtocolAuthForFlags(flags, ticketId = '') {
  return resolveAuth({ organizationIdHint: resolveOrganizationIdHint(flags, ticketId) });
}

function parseJsonFlag(flagName, rawValue) {
  try {
    return JSON.parse(String(rawValue));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${flagName} must be valid JSON: ${detail}`);
  }
}

function readTextFile(filePath, label) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `${label}: could not read "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Like readTextFile but accepts "-" to read from stdin. */
async function readTextFileOrStdin(filePath, label) {
  if (filePath === '-') {
    return readTextFromStdin(label);
  }
  return readTextFile(filePath, label);
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(readTextFile(filePath, label));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${label}: could not read`)) {
      throw err;
    }
    throw new Error(
      `${label}: could not parse "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function readTextFromStdin(label) {
  const chunks = [];
  try {
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
  } catch (err) {
    throw new Error(
      `${label}: could not read stdin: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonFileOrStdin(filePath, label) {
  if (filePath !== '-') {
    return readJsonFile(filePath, label);
  }

  try {
    return JSON.parse(await readTextFromStdin(label));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${label}: could not read stdin`)) {
      throw err;
    }
    throw new Error(
      `${label}: could not parse stdin: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function resolveObjectivesInput(flags, { payload = null, requireSingleObjective = true } = {}) {
  if (flags['objectives-json'] && flags['objectives-file']) {
    throw new Error('Use either --objectives-json or --objectives-file, not both');
  }
  if (payload && (flags['objectives-json'] || flags['objectives-file'])) {
    throw new Error('Use either payload input or --objectives-json/--objectives-file, not both');
  }

  if (payload?.objectives !== undefined) {
    if (!Array.isArray(payload.objectives) || payload.objectives.length === 0) {
      throw new Error('payload objectives must be a non-empty array');
    }
    return { objectives: payload.objectives };
  }

  if (flags['objectives-file']) {
    const objectives = await readJsonFileOrStdin(String(flags['objectives-file']), '--objectives-file');
    if (!Array.isArray(objectives) || objectives.length === 0) {
      throw new Error('--objectives-file must contain a non-empty JSON array');
    }
    return { objectives };
  }

  if (flags['objectives-json']) {
    const objectives = parseJsonFlag('--objectives-json', flags['objectives-json']);
    if (!Array.isArray(objectives) || objectives.length === 0) {
      throw new Error('--objectives-json must be a non-empty JSON array');
    }
    return { objectives };
  }

  if (requireSingleObjective) {
    throw new Error('Provide --objectives-json or --objectives-file');
  }

  throw new Error('Provide --objectives-json or --objectives-file');
}

// ---------------------------------------------------------------------------
// changeRationales helper
// ---------------------------------------------------------------------------

/**
 * Resolve changeRationales from --change-rationales-json or --change-rationales-file flags.
 * @param {Record<string, string | boolean>} flags
 * @returns {Promise<Array<object>>}
 */
async function resolveChangeRationales(flags) {
  if (flags['change-rationales-file']) {
    return await readJsonFileOrStdin(
      String(flags['change-rationales-file']),
      '--change-rationales-file'
    );
  }
  if (flags['change-rationales-json']) {
    return parseJsonFlag('--change-rationales-json', flags['change-rationales-json']);
  }
  return [];
}

async function resolveSnapshotContext(flags) {
  if (flags['snapshot-file']) {
    return await readJsonFileOrStdin(String(flags['snapshot-file']), '--snapshot-file');
  }
  if (flags['snapshot-json']) {
    return parseJsonFlag('--snapshot-json', flags['snapshot-json']);
  }
  if (process.env.OVERLORD_SNAPSHOT_JSON?.trim()) {
    return parseJsonFlag('--snapshot-json', process.env.OVERLORD_SNAPSHOT_JSON);
  }
  return null;
}

/**
 * Shallow-merge snapshot metadata: launch/env context first, then deliver payload
 * (payload wins on duplicate keys) so agents can add provenance details without
 * losing launch context from OVERLORD_SNAPSHOT_JSON.
 * @param {Record<string, unknown> | null | undefined} fromEnvOrFlags
 * @param {Record<string, unknown> | null | undefined} fromPayload
 * @returns {Record<string, unknown> | null}
 */
function mergeDeliverSnapshot(fromEnvOrFlags, fromPayload) {
  const base =
    fromEnvOrFlags && typeof fromEnvOrFlags === 'object' && !Array.isArray(fromEnvOrFlags)
      ? { ...fromEnvOrFlags }
      : {};
  const overlay =
    fromPayload && typeof fromPayload === 'object' && !Array.isArray(fromPayload)
      ? { ...fromPayload }
      : {};
  const merged = { ...base, ...overlay };
  return Object.keys(merged).length > 0 ? merged : null;
}

function runLocalCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 60000,
    maxBuffer: 10 * 1024 * 1024
  });
}

function resolveGitRepoRoot(workspacePath) {
  try {
    return runLocalCommand('git', ['-C', workspacePath, 'rev-parse', '--show-toplevel'], {
      cwd: workspacePath,
      timeoutMs: 15000
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Snapshot the working tree to a hidden ref refs/overlord/checkpoints/<objectiveId>.
 * Captures tracked + untracked + staged + unstaged in one commit-tree object.
 * Idempotent: if the ref already exists, returns the existing sha.
 * Returns null when not in a git repo or when no objectiveId is available.
 */
function createLocalCheckpoint({ flags, kind = 'objective', objectiveId, snapshot = null }) {
  if (flags['skip-checkpoint']) return null;

  const workspacePath = path.resolve(
    String(snapshot?.workspacePath ?? process.env.OVERLORD_WORKSPACE_PATH ?? process.cwd())
  );
  const repoRoot = fs.existsSync(workspacePath) ? resolveGitRepoRoot(workspacePath) : null;
  if (!repoRoot) return null;

  const resolvedObjectiveId =
    objectiveId ?? snapshot?.objectiveId ?? process.env.OVERLORD_OBJECTIVE_ID ?? null;
  if (!resolvedObjectiveId || !/^[A-Za-z0-9_-]+$/.test(String(resolvedObjectiveId))) {
    // Without an objective id we cannot name the ref deterministically.
    // Fall back to recording HEAD only so the protocol still has provenance.
    try {
      const gitCommitId = runLocalCommand('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
        cwd: repoRoot
      }).trim();
      const diffStat = runLocalCommand('git', ['-C', repoRoot, 'diff', '--stat', 'HEAD'], {
        cwd: repoRoot
      }).trim();
      return {
        checkpoint: { diffStat: diffStat || null, kind },
        snapshot: {
          gitCommitId: gitCommitId || null,
          headSha: gitCommitId || null,
          diffStat: diffStat || null
        }
      };
    } catch {
      return null;
    }
  }

  const ref = `refs/overlord/checkpoints/${resolvedObjectiveId}`;
  const headSha = runLocalCommand('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    cwd: repoRoot
  }).trim();

  // If the ref already exists, return the existing snapshot.
  let existingSha = '';
  try {
    existingSha = runLocalCommand('git', ['-C', repoRoot, 'rev-parse', '--verify', ref], {
      cwd: repoRoot
    }).trim();
  } catch {
    /* not present */
  }

  if (existingSha) {
    let diffStat = '';
    try {
      diffStat = runLocalCommand('git', ['-C', repoRoot, 'diff', '--stat', `${existingSha}^!`], {
        cwd: repoRoot
      }).trim();
    } catch {
      /* ignore */
    }
    return {
      checkpoint: { diffStat: diffStat || null, kind },
      snapshot: {
        gitCommitId: existingSha,
        gitRefName: ref,
        headSha,
        objectiveId: String(resolvedObjectiveId),
        diffStat: diffStat || null
      }
    };
  }

  // Build a tree from the current working copy without polluting the user's
  // index by writing to a temporary index file.
  const tempIndex = path.join(repoRoot, '.git', `overlord-snap-index-${Date.now()}`);
  const env = { ...process.env, NO_COLOR: '1', GIT_INDEX_FILE: tempIndex };
  try {
    execFileSync('git', ['-C', repoRoot, 'read-tree', 'HEAD'], { cwd: repoRoot, env });
    execFileSync('git', ['-C', repoRoot, 'add', '-A'], { cwd: repoRoot, env });
    const tree = execFileSync('git', ['-C', repoRoot, 'write-tree'], {
      cwd: repoRoot,
      env,
      encoding: 'utf8'
    }).trim();
    if (!tree) throw new Error('git write-tree produced no output.');
    const commit = execFileSync(
      'git',
      [
        '-C',
        repoRoot,
        'commit-tree',
        tree,
        '-p',
        headSha,
        '-m',
        `overlord checkpoint ${resolvedObjectiveId}`
      ],
      { cwd: repoRoot, env: { ...process.env, NO_COLOR: '1' }, encoding: 'utf8' }
    ).trim();
    if (!commit) throw new Error('git commit-tree produced no output.');
    execFileSync('git', ['-C', repoRoot, 'update-ref', ref, commit], {
      cwd: repoRoot
    });
    let diffStat = '';
    try {
      diffStat = runLocalCommand('git', ['-C', repoRoot, 'diff', '--stat', `${commit}^!`], {
        cwd: repoRoot
      }).trim();
    } catch {
      /* ignore */
    }
    return {
      checkpoint: { diffStat: diffStat || null, kind },
      snapshot: {
        gitCommitId: commit,
        gitRefName: ref,
        headSha,
        objectiveId: String(resolvedObjectiveId),
        diffStat: diffStat || null
      }
    };
  } catch (error) {
    throw new Error(
      `Failed to create git checkpoint in ${repoRoot}: ${
        error instanceof Error ? error.message : String(error)
      }\nRe-run attach with --skip-checkpoint to proceed without local provenance.`
    );
  } finally {
    try {
      fs.unlinkSync(tempIndex);
    } catch {
      /* ignore */
    }
  }
}

function snapshotLocalWorkingTree(repoRoot, parentSha, message) {
  const tempIndex = path.join(repoRoot, '.git', `overlord-snap-index-${Date.now()}`);
  const env = { ...process.env, NO_COLOR: '1', GIT_INDEX_FILE: tempIndex };
  try {
    execFileSync('git', ['-C', repoRoot, 'read-tree', 'HEAD'], { cwd: repoRoot, env });
    execFileSync('git', ['-C', repoRoot, 'add', '-A'], { cwd: repoRoot, env });
    const tree = execFileSync('git', ['-C', repoRoot, 'write-tree'], {
      cwd: repoRoot,
      env,
      encoding: 'utf8'
    }).trim();
    if (!tree) throw new Error('git write-tree produced no output.');
    return execFileSync(
      'git',
      ['-C', repoRoot, 'commit-tree', tree, '-p', parentSha, '-m', message],
      {
        cwd: repoRoot,
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8'
      }
    ).trim();
  } finally {
    try {
      fs.unlinkSync(tempIndex);
    } catch {
      /* ignore */
    }
  }
}

function restoreLocalCheckpoint({ workspacePath, objectiveId, gitCommitId }) {
  const repoRoot = resolveGitRepoRoot(workspacePath);
  if (!repoRoot) throw new Error(`No git repository found at ${workspacePath}.`);

  const ref = `refs/overlord/checkpoints/${objectiveId}`;
  const target = gitCommitId
    ? runLocalCommand('git', ['-C', repoRoot, 'rev-parse', '--verify', `${gitCommitId}^{commit}`], {
        cwd: repoRoot
      }).trim()
    : runLocalCommand('git', ['-C', repoRoot, 'rev-parse', '--verify', ref], {
        cwd: repoRoot
      }).trim();
  if (!target) throw new Error(`No checkpoint exists for objective ${objectiveId}.`);

  let safetyRef = null;
  let safetySha = null;
  try {
    const headSha = runLocalCommand('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      cwd: repoRoot
    }).trim();
    const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]/g, '');
    safetyRef = `refs/overlord/safety/${stamp}`;
    safetySha = snapshotLocalWorkingTree(
      repoRoot,
      headSha,
      `overlord pre-revert safety ${new Date().toISOString()}`
    );
    if (safetySha) {
      runLocalCommand('git', ['-C', repoRoot, 'update-ref', safetyRef, safetySha], {
        cwd: repoRoot
      });
    }
  } catch {
    safetyRef = null;
    safetySha = null;
  }

  runLocalCommand('git', ['-C', repoRoot, 'read-tree', '--reset', '-u', target], {
    cwd: repoRoot
  });

  return { ref, gitCommitId: target, safetyRef, safetySha };
}

async function createAndRecordPendingCheckpoints({
  attachData,
  bearerToken,
  flags,
  localSecret,
  organizationId,
  platformUrl,
  ticketId,
  timeoutMs
}) {
  const pendingObjectiveIds = Array.isArray(attachData.pendingCheckpointObjectiveIds)
    ? attachData.pendingCheckpointObjectiveIds.filter(id => typeof id === 'string' && id.trim())
    : [];
  const sessionKey = attachData.session?.sessionKey;
  if (!sessionKey || pendingObjectiveIds.length === 0) return [];

  const recorded = [];
  for (const objectiveId of pendingObjectiveIds) {
    const checkpointResult = createLocalCheckpoint({
      flags,
      kind: 'objective',
      objectiveId: objectiveId.trim()
    });
    if (!checkpointResult?.snapshot) {
      process.stderr.write(
        `[protocol] Skipped checkpoint for objective ${objectiveId}: no git repository found at ${process.cwd()}.\n`
      );
      continue;
    }

    await apiPost(
      platformUrl,
      bearerToken,
      localSecret,
      organizationId,
      '/api/protocol/update',
      {
        sessionKey,
        ticketId,
        summary: `Created local git checkpoint for objective ${objectiveId}.`,
        phase: 'execute',
        snapshot: checkpointResult.snapshot
      },
      timeoutMs
    );
    recorded.push(objectiveId);
  }
  return recorded;
}

function normalizeRepoRelativeFilePath(filePath, repoRoot) {
  if (typeof filePath !== 'string') return null;

  const trimmed = filePath.trim();
  if (!trimmed) return null;

  if (path.isAbsolute(trimmed)) {
    const relative = path.relative(repoRoot, trimmed);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    return relative.replaceAll(path.sep, '/');
  }

  return trimmed.replace(/^[.][/\\]+/, '').replaceAll('\\', '/');
}

function getGitChangedFiles() {
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();

    if (!repoRoot) return null;

    const output = execFileSync('git', ['status', '--porcelain=v1', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const changedFiles = new Set();
    const entries = output.split('\0');

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;

      const status = entry.slice(0, 2);
      const normalizedPath = normalizeRepoRelativeFilePath(entry.slice(3), repoRoot);
      if (normalizedPath) {
        changedFiles.add(normalizedPath);
      }

      if (status.includes('R') || status.includes('C')) {
        i += 1;
      }
    }

    return { repoRoot, changedFiles };
  } catch {
    return null;
  }
}

function createFileChangeCheckError(message, changedFiles, rationalePaths = []) {
  const changedPreview = [...changedFiles].slice(0, 10).join(', ');
  const rationalePreview = rationalePaths.slice(0, 10).join(', ');

  return new Error(
    `${message}\n` +
      `Overlord persists file changes through \`changeRationales\`, not \`file_changes\` artifacts.\n` +
      `Re-run with --change-rationales-json or --change-rationales-file, or pass --skip-file-change-check if this was intentional.` +
      `${changedPreview ? `\nChanged files: ${changedPreview}${changedFiles.size > 10 ? ', ...' : ''}` : ''}` +
      `${rationalePreview ? `\nProvided rationale paths: ${rationalePreview}${rationalePaths.length > 10 ? ', ...' : ''}` : ''}`
  );
}

function validateDeliverFileChanges(flags, changeRationales) {
  if (flags['skip-file-change-check']) return;

  const gitState = getGitChangedFiles();
  if (!gitState || gitState.changedFiles.size === 0) return;

  const rationalePaths = changeRationales
    .map(rationale => normalizeRepoRelativeFilePath(rationale?.file_path, gitState.repoRoot))
    .filter(Boolean);

  if (rationalePaths.length === 0) {
    throw createFileChangeCheckError(
      'Git shows changed files in this workspace, but this delivery did not include matching `changeRationales`.',
      gitState.changedFiles
    );
  }

  const hasMatch = rationalePaths.some(filePath => gitState.changedFiles.has(filePath));
  if (!hasMatch) {
    throw createFileChangeCheckError(
      'Git shows changed files in this workspace, but none of the supplied `changeRationales.file_path` entries match them.',
      gitState.changedFiles,
      rationalePaths
    );
  }
}

// ---------------------------------------------------------------------------
// Auto-detect native agent session IDs
// ---------------------------------------------------------------------------

/**
 * Attempt to detect the current Claude Code session ID by finding the most
 * recently modified .jsonl conversation file in ~/.claude/projects/<project>/.
 * Returns the UUID or null if detection fails.
 */
function detectClaudeSessionId() {
  try {
    const cwd = process.cwd();
    const projectDir = cwd.replace(/\//g, '-');
    const sessionsDir = path.join(os.homedir(), '.claude', 'projects', projectDir);

    if (!fs.existsSync(sessionsDir)) return null;

    const files = fs
      .readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    const uuid = files[0].name.replace('.jsonl', '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
      return uuid;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Codex exposes the active resumable thread id directly in the runtime
 * environment, so prefer that over filesystem heuristics.
 */
function detectCodexSessionId() {
  const sessionId = process.env.CODEX_THREAD_ID?.trim() || process.env.CODEX_SESSION_ID?.trim();
  return sessionId || null;
}

/**
 * Resolve the external session ID from flags, env, or auto-detection.
 * Priority: explicit flag > env var > auto-detect.
 */
function resolveExternalSessionId(flags) {
  if (flags['external-session-id']) {
    const val = String(flags['external-session-id']).trim();
    return val.toLowerCase() === 'null' ? null : val;
  }

  const agentId = String(flags.agent ?? process.env.AGENT_IDENTIFIER ?? '').toLowerCase();
  if (agentId.includes('codex')) {
    const detected = detectCodexSessionId();
    if (detected) return detected;
  }

  if (agentId.includes('claude') || agentId === '' || agentId === 'claude-code') {
    const detected = detectClaudeSessionId();
    if (detected) return detected;
  }

  return undefined; // undefined = omit from payload
}

// ---------------------------------------------------------------------------
// attach
// ---------------------------------------------------------------------------

async function protocolAttach(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', 'TICKET_ID');
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const externalSessionId = resolveExternalSessionId(flags);

  const body = {
    ticketId,
    agentIdentifier: resolveProtocolAgentIdentifier(flags),
    connectionMethod: String(flags.method ?? 'cli'),
    ...(externalSessionId !== undefined ? { externalSessionId } : {}),
    metadata: await resolveProtocolMetadata(flags, { cwd: process.cwd() })
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/attach',
    body,
    timeoutMs
  );

  const recordedCheckpointObjectiveIds = await createAndRecordPendingCheckpoints({
    attachData: data,
    bearerToken,
    flags,
    localSecret,
    organizationId,
    platformUrl,
    ticketId,
    timeoutMs
  });
  if (recordedCheckpointObjectiveIds.length > 0) {
    data.recordedCheckpointObjectiveIds = recordedCheckpointObjectiveIds;
  }

  const sessionKey = data.session?.sessionKey;
  console.log(JSON.stringify(data, null, 2));

  if (sessionKey) {
    persistSession(sessionKey, ticketId);
    // Emit a machine-readable line for easy shell capture:
    // SESSION_KEY=$(ovld protocol attach --ticket-id ... | grep ^SESSION_KEY= | cut -d= -f2)
    process.stderr.write(`\nSESSION_KEY=${sessionKey}\n`);
  }
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

async function protocolUpdate(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const summary = flags['summary-file']
    ? await readTextFileOrStdin(String(flags['summary-file']), '--summary-file')
    : requireFlag(flags, 'summary', undefined);

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);
  const changeRationales = await resolveChangeRationales(flags);
  const externalSessionId = resolveExternalSessionId(flags);
  const snapshot = await resolveSnapshotContext(flags);

  const body = {
    sessionKey,
    ticketId,
    summary,
    ...(externalSessionId !== undefined ? { externalSessionId } : {}),
    ...(flags['external-url']
      ? {
          externalUrl:
            String(flags['external-url']).trim().toLowerCase() === 'null'
              ? null
              : String(flags['external-url'])
        }
      : {}),
    ...(flags.phase ? { phase: String(flags.phase) } : {}),
    ...(flags['event-type'] ? { eventType: String(flags['event-type']) } : {}),
    ...(flags['begin-follow-up-work'] !== undefined ? { beginFollowUpWork: true } : {}),
    ...(flags['follow-up-intent'] ? { followUpIntent: String(flags['follow-up-intent']) } : {}),
    ...(flags['payload-json']
      ? { payload: parseJsonFlag('--payload-json', flags['payload-json']) }
      : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(changeRationales.length > 0 ? { changeRationales } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/update',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// heartbeat
// ---------------------------------------------------------------------------

async function protocolHeartbeat(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);
  const externalSessionId = resolveExternalSessionId(flags);
  const percent =
    flags.percent !== undefined && flags.percent !== true ? Number(flags.percent) : undefined;

  if (percent !== undefined && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
    throw new Error('--percent must be a number between 0 and 100');
  }

  const body = {
    sessionKey,
    ticketId,
    ...(flags.phase ? { phase: String(flags.phase) } : {}),
    ...(percent !== undefined ? { percent } : {}),
    ...(flags.note ? { note: String(flags.note) } : {}),
    ...(externalSessionId !== undefined ? { externalSessionId } : {}),
    ...(flags['external-url']
      ? {
          externalUrl:
            String(flags['external-url']).trim().toLowerCase() === 'null'
              ? null
              : String(flags['external-url'])
        }
      : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/heartbeat',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// record-change-rationales
// ---------------------------------------------------------------------------

async function protocolRecordChangeRationales(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');

  const changeRationales = await resolveChangeRationales(flags);
  if (changeRationales.length === 0) {
    throw new Error(
      'Provide at least one rationale with --change-rationales-json or --change-rationales-file'
    );
  }

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);
  const snapshot = await resolveSnapshotContext(flags);

  const body = {
    sessionKey,
    ticketId,
    changeRationales,
    ...(flags['summary-file']
      ? { summary: await readTextFileOrStdin(String(flags['summary-file']), '--summary-file') }
      : flags.summary
        ? { summary: String(flags.summary) }
        : {}),
    ...(flags.phase ? { phase: String(flags.phase) } : {}),
    ...(snapshot ? { snapshot } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/record-change-rationales',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// ask
// ---------------------------------------------------------------------------

async function protocolAsk(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const question = flags['question-file']
    ? await readTextFileOrStdin(String(flags['question-file']), '--question-file')
    : requireFlag(flags, 'question', undefined);

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    question,
    ...(flags.phase ? { phase: String(flags.phase) } : {}),
    ...(flags['payload-json']
      ? { payload: parseJsonFlag('--payload-json', flags['payload-json']) }
      : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/ask',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// request-approval-gate
// ---------------------------------------------------------------------------

async function protocolRequestApprovalGate(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const reason = flags['reason-file']
    ? await readTextFileOrStdin(String(flags['reason-file']), '--reason-file')
    : requireFlag(flags, 'reason', undefined);

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    reason,
    ...(flags['objective-id'] ? { objectiveId: String(flags['objective-id']) } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/request-approval-gate',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// permission-request
// ---------------------------------------------------------------------------

async function protocolPermissionRequest(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', 'TICKET_ID');
  const payload = flags['payload-file']
    ? await readJsonFileOrStdin(String(flags['payload-file']), '--payload-file')
    : {};

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    `/api/protocol/permission-request?ticketId=${encodeURIComponent(ticketId)}`,
    payload,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// hook-event
// ---------------------------------------------------------------------------

async function protocolHookEvent(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', 'TICKET_ID');
  const hookType = requireFlag(flags, 'hook-type', undefined);

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const sessionKey = String(flags['session-key'] ?? process.env.SESSION_KEY ?? '');

  const body = {
    hookType,
    ticketId,
    ...(flags.prompt !== undefined ? { prompt: String(flags.prompt) } : {}),
    ...(flags['turn-index'] !== undefined
      ? { turnIndex: parseInt(String(flags['turn-index']), 10) }
      : {}),
    ...(flags['follow-up-intent'] ? { followUpIntent: String(flags['follow-up-intent']) } : {}),
    ...(sessionKey ? { sessionKey } : {})
  };

  try {
    const data = await apiPost(
      platformUrl,
      bearerToken,
      localSecret,
      organizationId,
      '/api/protocol/hook-event',
      body,
      timeoutMs
    );
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[protocol] hook-event skipped: ${message}\n`);
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  }
}

// ---------------------------------------------------------------------------
// read-context
// ---------------------------------------------------------------------------

async function protocolReadContext(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    ...(flags.query ? { query: String(flags.query) } : {}),
    ...(flags.limit ? { limit: parseInt(String(flags.limit), 10) } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/read-context',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// write-context
// ---------------------------------------------------------------------------

async function protocolWriteContext(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const key = requireFlag(flags, 'key', undefined);

  if (flags.value === undefined) {
    throw new Error('--value is required');
  }

  let value;
  try {
    value = JSON.parse(String(flags.value));
  } catch {
    value = String(flags.value);
  }

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    key,
    value,
    ...(flags.tags
      ? {
          tags: String(flags.tags)
            .split(',')
            .map(t => t.trim())
        }
      : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/write-context',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// deliver
// ---------------------------------------------------------------------------

async function protocolDeliver(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  if (flags['payload-file'] && flags['payload-json']) {
    throw new Error('Use either --payload-file or --payload-json, not both');
  }
  const deliverPayload = flags['payload-file']
    ? await readJsonFileOrStdin(String(flags['payload-file']), '--payload-file')
    : flags['payload-json']
      ? parseJsonFlag('--payload-json', flags['payload-json'])
      : null;
  if (deliverPayload && (flags.summary || flags['summary-file'])) {
    throw new Error('Use either payload input or --summary/--summary-file, not both');
  }
  const summary = deliverPayload
    ? (() => {
        const value = deliverPayload.summary;
        if (typeof value !== 'string' || !value.trim()) {
          throw new Error('payload input must include a non-empty summary');
        }
        return value;
      })()
    : flags['summary-file']
      ? await readTextFileOrStdin(String(flags['summary-file']), '--summary-file')
      : requireFlag(flags, 'summary', undefined);

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  let artifacts = deliverPayload?.artifacts ?? [];
  if (deliverPayload && flags['artifacts-file']) {
    throw new Error('Use either payload input or --artifacts-file, not both');
  }
  if (deliverPayload && flags['artifacts-json']) {
    throw new Error('Use either payload input or --artifacts-json, not both');
  }
  if (flags['artifacts-file']) {
    artifacts = await readJsonFileOrStdin(String(flags['artifacts-file']), '--artifacts-file');
  } else if (flags['artifacts-json']) {
    artifacts = parseJsonFlag('--artifacts-json', flags['artifacts-json']);
  }

  if (deliverPayload && (flags['change-rationales-file'] || flags['change-rationales-json'])) {
    throw new Error('Use either payload input or change-rationale flags, not both');
  }

  const changeRationales =
    deliverPayload?.changeRationales ?? (await resolveChangeRationales(flags));
  const snapshot = mergeDeliverSnapshot(
    await resolveSnapshotContext(flags),
    deliverPayload?.snapshot ?? null
  );
  validateDeliverFileChanges(flags, changeRationales);

  const body = {
    sessionKey,
    ticketId,
    summary,
    artifacts,
    ...(snapshot ? { snapshot } : {}),
    ...(changeRationales.length > 0 ? { changeRationales } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/deliver',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// objective attachments
// ---------------------------------------------------------------------------

async function protocolAttachmentList(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  const objectiveId = flags['objective-id'] ? String(flags['objective-id']) : '';
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId && !objectiveId) {
    throw new Error('--objective-id or --ticket-id is required');
  }

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ...(ticketId ? { ticketId } : {}),
    ...(objectiveId ? { objectiveId } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/attachments/list',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolAttachmentPrepareUpload(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  const objectiveId = requireFlag(flags, 'objective-id', undefined);
  const fileName = requireFlag(flags, 'file-name', undefined);

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ...(ticketId ? { ticketId } : {}),
    objectiveId,
    fileName,
    ...(flags.label ? { label: String(flags.label) } : {}),
    ...(flags['content-type'] ? { contentType: String(flags['content-type']) } : {}),
    ...(flags['file-size'] ? { fileSize: parseInt(String(flags['file-size']), 10) } : {}),
    ...(flags['metadata-json']
      ? { metadata: parseJsonFlag('--metadata-json', flags['metadata-json']) }
      : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/attachments/prepare-upload',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolAttachmentFinalizeUpload(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  const objectiveId = requireFlag(flags, 'objective-id', undefined);
  const storagePath = requireFlag(flags, 'storage-path', undefined);
  const label = requireFlag(flags, 'label', undefined);

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ...(ticketId ? { ticketId } : {}),
    objectiveId,
    storagePath,
    label,
    ...(flags['content-type'] ? { contentType: String(flags['content-type']) } : {}),
    ...(flags['file-size'] ? { fileSize: parseInt(String(flags['file-size']), 10) } : {}),
    ...(flags['metadata-json']
      ? { metadata: parseJsonFlag('--metadata-json', flags['metadata-json']) }
      : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/attachments/finalize-upload',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolAttachmentGetDownloadUrl(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!flags['attachment-id'] && !flags['storage-path']) {
    throw new Error('--attachment-id or --storage-path is required');
  }
  if (flags['storage-path'] && !flags['objective-id']) {
    throw new Error('--objective-id is required when using --storage-path');
  }

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ...(ticketId ? { ticketId } : {}),
    ...(flags['objective-id'] ? { objectiveId: String(flags['objective-id']) } : {}),
    ...(flags['attachment-id'] ? { attachmentId: String(flags['attachment-id']) } : {}),
    ...(flags['storage-path'] ? { storagePath: String(flags['storage-path']) } : {}),
    ...(flags['expires-in'] ? { expiresIn: parseInt(String(flags['expires-in']), 10) } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/attachments/get-download-url',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolAttachmentUploadFile(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  const objectiveId = requireFlag(flags, 'objective-id', undefined);
  const filePath = requireFlag(flags, 'file', undefined);

  const { readFile, stat } = await import('node:fs/promises');
  const path = await import('node:path');
  const fileName = String(flags['file-name'] ?? path.basename(filePath));
  const contentType = String(flags['content-type'] ?? 'application/octet-stream');
  const label = String(flags.label ?? fileName);

  const fileStats = await stat(filePath);
  const fileBytes = await readFile(filePath);

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const metadata = flags['metadata-json']
    ? parseJsonFlag('--metadata-json', flags['metadata-json'])
    : undefined;

  const prepared = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/attachments/prepare-upload',
    {
      sessionKey,
      ...(ticketId ? { ticketId } : {}),
      objectiveId,
      fileName,
      label,
      contentType,
      fileSize: fileStats.size,
      ...(metadata ? { metadata } : {})
    },
    timeoutMs
  );

  const uploadUrl = prepared?.upload?.url;
  const storagePath = prepared?.draft?.storagePath;
  if (!uploadUrl || !storagePath) {
    throw new Error('Prepare upload response missing upload URL or storagePath.');
  }

  await uploadToSignedUrl(uploadUrl, fileBytes, contentType, timeoutMs);

  const finalized = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/attachments/finalize-upload',
    {
      sessionKey,
      ...(ticketId ? { ticketId } : {}),
      objectiveId,
      storagePath,
      label,
      contentType,
      fileSize: fileStats.size,
      ...(metadata ? { metadata } : {})
    },
    timeoutMs
  );

  console.log(JSON.stringify(finalized, null, 2));
}

// ---------------------------------------------------------------------------
// discover-project (resolve project from working directory)
// ---------------------------------------------------------------------------

async function protocolDiscoverProject(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const workingDirectory =
    flags['working-directory'] !== undefined ? String(flags['working-directory']) : process.cwd();

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/discover-project',
    {
      ...(flags['project-id'] ? { projectId: String(flags['project-id']) } : { workingDirectory }),
      ...(flags['device-fingerprint']
        ? { deviceFingerprint: String(flags['device-fingerprint']) }
        : {}),
      ...(flags['device-hostname'] ? { deviceHostname: String(flags['device-hostname']) } : {}),
      ...(flags['device-platform'] ? { devicePlatform: String(flags['device-platform']) } : {})
    },
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));

  if (data.project?.id) {
    process.stderr.write(`\nPROJECT_ID=${data.project.id}\n`);
  }
}

// ---------------------------------------------------------------------------
// get-device (identify / register the current device)
// ---------------------------------------------------------------------------

async function protocolGetDevice(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const deviceFingerprint = String(flags['device-fingerprint'] ?? process.env.OVERLORD_DEVICE_FINGERPRINT ?? '');
  if (!deviceFingerprint) {
    console.error('Error: --device-fingerprint is required (or set OVERLORD_DEVICE_FINGERPRINT)');
    process.exit(1);
  }

  const body = {
    deviceFingerprint,
    ...(flags['device-hostname'] ? { deviceHostname: String(flags['device-hostname']) } : {}),
    ...(flags['device-platform'] ? { devicePlatform: String(flags['device-platform']) } : {}),
    ...(flags['device-port'] != null ? { devicePort: Number(flags['device-port']) } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/get-device',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));

  if (data.device?.label) {
    process.stderr.write(`\nDEVICE_LABEL=${data.device.label}\n`);
  }
  if (data.device?.id) {
    process.stderr.write(`DEVICE_ID=${data.device.id}\n`);
  }
}

// ---------------------------------------------------------------------------
// update-device (rename the device label)
// ---------------------------------------------------------------------------

async function protocolUpdateDevice(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const deviceFingerprint = String(flags['device-fingerprint'] ?? process.env.OVERLORD_DEVICE_FINGERPRINT ?? '');
  if (!deviceFingerprint) {
    console.error('Error: --device-fingerprint is required (or set OVERLORD_DEVICE_FINGERPRINT)');
    process.exit(1);
  }
  const label = typeof flags.label === 'string' ? flags.label.trim() : '';
  if (!label) {
    console.error('Error: --label is required');
    process.exit(1);
  }

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/update-device',
    { deviceFingerprint, label },
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// list-project-resources (list resource directories for a project)
// ---------------------------------------------------------------------------

async function protocolListProjectResources(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const projectId = typeof flags['project-id'] === 'string' ? flags['project-id'].trim() : '';
  if (!projectId) {
    console.error('Error: --project-id is required');
    process.exit(1);
  }

  const deviceFingerprint = typeof flags['device-fingerprint'] === 'string'
    ? flags['device-fingerprint'].trim()
    : (process.env.OVERLORD_DEVICE_FINGERPRINT?.trim() ?? '');

  const body = {
    projectId,
    ...(deviceFingerprint ? { deviceFingerprint } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/list-project-resources',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// add-project-resource (register a directory for a project on this device)
// ---------------------------------------------------------------------------

async function protocolAddProjectResource(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const projectId = typeof flags['project-id'] === 'string' ? flags['project-id'].trim() : '';
  const directoryPath = typeof flags['directory'] === 'string'
    ? flags['directory'].trim()
    : process.cwd();
  const deviceFingerprint = String(
    flags['device-fingerprint'] ?? process.env.OVERLORD_DEVICE_FINGERPRINT ?? ''
  );

  if (!projectId) {
    console.error('Error: --project-id is required');
    process.exit(1);
  }
  if (!deviceFingerprint) {
    console.error('Error: --device-fingerprint is required (or set OVERLORD_DEVICE_FINGERPRINT)');
    process.exit(1);
  }

  // Verify directory exists on this device before sending to server
  const fs = await import('node:fs');
  if (!fs.existsSync(directoryPath)) {
    console.error(`Error: Directory does not exist: ${directoryPath}`);
    process.exit(1);
  }

  const body = {
    projectId,
    directoryPath,
    deviceFingerprint,
    ...(typeof flags.label === 'string' ? { label: flags.label } : {}),
    ...(flags['is-primary'] === true || flags['is-primary'] === 'true' ? { isPrimary: true } : {}),
    ...(flags['device-hostname'] ? { deviceHostname: String(flags['device-hostname']) } : {}),
    ...(flags['device-platform'] ? { devicePlatform: String(flags['device-platform']) } : {}),
    ...(flags['device-port'] != null ? { devicePort: Number(flags['device-port']) } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/add-project-resource',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));

  if (data.resource?.id) {
    process.stderr.write(`\nRESOURCE_ID=${data.resource.id}\n`);
  }

  if (data.project?.id && data.project?.name) {
    try {
      const { upsertLocalOverlordConfig } = await import('./local-config.mjs');
      const result = await upsertLocalOverlordConfig({
        directoryPath,
        project: { id: data.project.id, name: data.project.name }
      });
      process.stderr.write(`OVERLORD_CONFIG=${result.filePath} (${result.action})\n`);
    } catch (configError) {
      process.stderr.write(
        `\nWarning: could not write .overlord/project.json: ${configError instanceof Error ? configError.message : configError}\n`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// update-project-resource (update path, label, or primary status)
// ---------------------------------------------------------------------------

async function protocolUpdateProjectResource(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const resourceId = typeof flags['resource-id'] === 'string' ? flags['resource-id'].trim() : '';
  const deviceFingerprint = String(
    flags['device-fingerprint'] ?? process.env.OVERLORD_DEVICE_FINGERPRINT ?? ''
  );

  if (!resourceId) {
    console.error('Error: --resource-id is required');
    process.exit(1);
  }
  if (!deviceFingerprint) {
    console.error('Error: --device-fingerprint is required (or set OVERLORD_DEVICE_FINGERPRINT)');
    process.exit(1);
  }

  const body = {
    resourceId,
    deviceFingerprint,
    ...(typeof flags.directory === 'string' ? { directoryPath: flags.directory.trim() } : {}),
    ...('label' in flags ? { label: flags.label === 'null' ? null : String(flags.label) } : {}),
    ...(flags['is-primary'] !== undefined
      ? { isPrimary: flags['is-primary'] === true || flags['is-primary'] === 'true' }
      : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/update-project-resource',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// execution requests (durable runner queue)
// ---------------------------------------------------------------------------

async function protocolRequestExecution(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', 'TICKET_ID');
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    ticketId,
    ...(typeof flags['objective-id'] === 'string' ? { objectiveId: flags['objective-id'] } : {}),
    requestedFrom: String(flags['requested-from'] ?? 'api'),
    ...(typeof flags['idempotency-key'] === 'string'
      ? { idempotencyKey: flags['idempotency-key'] }
      : {}),
    ...(typeof flags.agent === 'string' ? { agentIdentifier: flags.agent } : {}),
    ...(typeof flags.model === 'string' ? { modelIdentifier: flags.model } : {}),
    ...(typeof flags.thinking === 'string' ? { thinkingLevel: flags.thinking } : {}),
    launchMode: flags['launch-mode'] === 'ask' ? 'ask' : 'run',
    flags: parseRepeatedCliFlags(args, 'flag'),
    ...(typeof flags['working-directory'] === 'string'
      ? { workingDirectory: flags['working-directory'] }
      : {}),
    ...(typeof flags['ssh-command'] === 'string' ? { sshCommand: flags['ssh-command'] } : {}),
    ...(typeof flags['remote-working-directory'] === 'string'
      ? { remoteWorkingDirectory: flags['remote-working-directory'] }
      : {}),
    ...(flags['server-multiplexer'] === 'tmux' ? { serverMultiplexer: 'tmux' } : {}),
    ...(typeof flags['tmux-command'] === 'string' ? { tmuxCommand: flags['tmux-command'] } : {}),
    ...(typeof flags['target-kind'] === 'string' ? { targetKind: flags['target-kind'] } : {}),
    ...(typeof flags['target-device-id'] === 'string'
      ? { targetDeviceId: flags['target-device-id'] }
      : {}),
    ...(typeof flags['target-resource-id'] === 'string'
      ? { targetResourceId: flags['target-resource-id'] }
      : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/request-execution',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));

  if (data.request?.id) {
    process.stderr.write(`\nEXECUTION_REQUEST_ID=${data.request.id}\n`);
  }
}

async function protocolClaimExecution(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);
  const deviceFingerprint = String(
    flags['device-fingerprint'] ?? process.env.OVERLORD_DEVICE_FINGERPRINT ?? ''
  );
  if (!deviceFingerprint) {
    console.error('Error: --device-fingerprint is required (or set OVERLORD_DEVICE_FINGERPRINT)');
    process.exit(1);
  }

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/claim-execution',
    {
      deviceFingerprint,
      ...(flags['device-hostname'] ? { deviceHostname: String(flags['device-hostname']) } : {}),
      ...(flags['device-platform'] ? { devicePlatform: String(flags['device-platform']) } : {}),
      ...(typeof flags['lease-seconds'] === 'string'
        ? { leaseSeconds: Number.parseInt(flags['lease-seconds'], 10) }
        : {}),
      ...(typeof flags['project-id'] === 'string' ? { projectId: flags['project-id'] } : {})
    },
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolListOrganizations(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/organizations',
    {},
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolListExecutionRequests(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/list-execution-requests',
    {
      ...(typeof flags['device-fingerprint'] === 'string'
        ? { deviceFingerprint: flags['device-fingerprint'] }
        : {}),
      ...(typeof flags['project-id'] === 'string' ? { projectId: flags['project-id'] } : {})
    },
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolClearExecutionRequests(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const clearAll = flags['clear-all'] === true || flags['clear-all'] === 'true';
  const objectiveId = typeof flags['objective-id'] === 'string' ? flags['objective-id'].trim() : '';
  if (!clearAll && !objectiveId) {
    console.error('Error: --objective-id is required unless --clear-all is set');
    process.exit(1);
  }

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/clear-execution-requests',
    {
      ...(objectiveId ? { objectiveId } : {}),
      ...(clearAll ? { clearAll: true } : {}),
      ...(typeof flags['project-id'] === 'string' ? { projectId: flags['project-id'] } : {})
    },
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolCompleteExecutionLaunch(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);
  const requestId = requireFlag(flags, 'request-id', 'EXECUTION_REQUEST_ID');
  const deviceFingerprint = String(
    flags['device-fingerprint'] ?? process.env.OVERLORD_DEVICE_FINGERPRINT ?? ''
  );
  if (!deviceFingerprint) {
    console.error('Error: --device-fingerprint is required (or set OVERLORD_DEVICE_FINGERPRINT)');
    process.exit(1);
  }

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/complete-execution-launch',
    {
      requestId,
      deviceFingerprint,
      ...(typeof flags['launched-session-id'] === 'string'
        ? { launchedSessionId: flags['launched-session-id'] }
        : {})
    },
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolFailExecutionLaunch(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);
  const requestId = requireFlag(flags, 'request-id', 'EXECUTION_REQUEST_ID');
  const deviceFingerprint = String(
    flags['device-fingerprint'] ?? process.env.OVERLORD_DEVICE_FINGERPRINT ?? ''
  );
  if (!deviceFingerprint) {
    console.error('Error: --device-fingerprint is required (or set OVERLORD_DEVICE_FINGERPRINT)');
    process.exit(1);
  }
  const error = requireFlag(flags, 'error');

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/fail-execution-launch',
    { requestId, deviceFingerprint, error },
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// connect (lightweight session, no context returned)
// ---------------------------------------------------------------------------

async function protocolConnect(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', 'TICKET_ID');
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    ticketId,
    agentIdentifier: resolveProtocolAgentIdentifier(flags),
    connectionMethod: String(flags.method ?? 'cli'),
    metadata: await resolveProtocolMetadata(flags, { cwd: process.cwd() })
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/connect',
    body,
    timeoutMs
  );

  const sessionKey = data.session?.sessionKey;
  console.log(JSON.stringify(data, null, 2));

  if (sessionKey) {
    persistSession(sessionKey, ticketId);
    process.stderr.write(`\nSESSION_KEY=${sessionKey}\n`);
  }
}

// ---------------------------------------------------------------------------
// load-context (read-only ticket fetch, no session)
// ---------------------------------------------------------------------------

async function protocolLoadContext(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', 'TICKET_ID');
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = { ticketId };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/load-context',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// revert (restore local working tree to an objective checkpoint)
// ---------------------------------------------------------------------------

async function protocolRevert(args) {
  const flags = parseFlags(args);
  const objectiveId = requireFlag(flags, 'objective-id', 'OVERLORD_OBJECTIVE_ID');
  const workspacePath = path.resolve(
    String(flags['working-directory'] ?? process.env.OVERLORD_WORKSPACE_PATH ?? process.cwd())
  );
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/revert',
    { objectiveId },
    timeoutMs
  );
  const checkpoint = data?.checkpoint;
  if (!checkpoint?.git_commit_id) {
    throw new Error('API response did not include a checkpoint git_commit_id.');
  }

  const result = restoreLocalCheckpoint({
    workspacePath,
    objectiveId,
    gitCommitId: checkpoint.git_commit_id
  });
  console.log(JSON.stringify({ ok: true, checkpoint, restore: result }, null, 2));
}

// ---------------------------------------------------------------------------
// prompt (create ticket + connect in one call)
// ---------------------------------------------------------------------------

async function protocolPrompt(args) {
  const flags = parseFlags(args);
  const objectiveInput = await resolveObjectivesInput(flags);
  const parentTicketId =
    flags['parent-ticket-id'] !== undefined
      ? String(flags['parent-ticket-id'] ?? process.env.TICKET_ID ?? '')
      : '';
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, parentTicketId);
  const timeoutMs = resolveTimeout(flags);
  const agentIdentifier = resolveProtocolAgentIdentifier(flags);
  const modelIdentifier = resolveProtocolModelIdentifier(flags);

  // When --project-id is not provided, auto-send cwd as workingDirectory so
  // the server can resolve the project from the caller's project_user
  // project resource directory setting.
  const personal = Boolean(flags.personal);
  const workingDirectory =
    flags['working-directory'] ?? (!flags['project-id'] && !personal ? process.cwd() : undefined);
  const forHuman = resolveForHumanFlag(flags);

  const body = {
    ...objectiveInput,
    agentIdentifier,
    connectionMethod: String(flags.method ?? 'cli'),
    metadata: await resolveProtocolMetadata(flags, { cwd: process.cwd() }),
    ...(flags.title ? { title: String(flags.title) } : {}),
    ...(flags.priority ? { priority: String(flags.priority) } : {}),
    ...(flags['project-id'] ? { projectId: String(flags['project-id']) } : {}),
    ...(personal ? { personal: true } : {}),
    ...(workingDirectory ? { workingDirectory: String(workingDirectory) } : {}),
    ...(flags['acceptance-criteria']
      ? { acceptanceCriteria: String(flags['acceptance-criteria']) }
      : {}),
    ...(flags['available-tools'] ? { availableTools: String(flags['available-tools']) } : {}),
    ...(forHuman !== undefined ? { forHuman } : {}),
    delegate: resolveProtocolTicketDelegate(flags, modelIdentifier, agentIdentifier),
    ...(flags['parent-session-key']
      ? { parentSessionKey: String(flags['parent-session-key']) }
      : {}),
    ...(parentTicketId ? { parentTicketId } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/prompt',
    body,
    timeoutMs
  );

  const sessionKey = data.session?.sessionKey;
  const ticketId = data.ticket?.ticket_id ?? data.ticket?.id;
  console.log(JSON.stringify(data, null, 2));

  if (sessionKey) {
    if (ticketId) persistSession(sessionKey, ticketId);
    process.stderr.write(`\nSESSION_KEY=${sessionKey}\n`);
  }
  if (ticketId) {
    process.stderr.write(`TICKET_ID=${ticketId}\n`);
  }
}

// ---------------------------------------------------------------------------
// discuss-objective (mark a draft objective as submitted)
// ---------------------------------------------------------------------------

async function protocolDiscussObjective(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', process.env.TICKET_ID);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const body = {
    ticketId,
    ...(flags['objective-id'] ? { objectiveId: String(flags['objective-id']) } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/discuss-objective',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// create (create follow-up ticket draft only)
// ---------------------------------------------------------------------------

async function protocolCreateTicket(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  const objectiveInput = await resolveObjectivesInput(flags);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);
  const agentIdentifier = resolveProtocolAgentIdentifier(flags);
  const modelIdentifier = resolveProtocolModelIdentifier(flags);
  const forHuman = resolveForHumanFlag(flags);

  const hasSessionContext = Boolean(sessionKey && ticketId);

  // Follow-up mode: create a draft ticket linked to the current session ticket.
  if (hasSessionContext) {
    const body = {
      sessionKey,
      ticketId,
      ...objectiveInput,
      ...(flags.title ? { title: String(flags.title) } : {}),
      ...(flags.priority ? { priority: String(flags.priority) } : {}),
      ...(flags['acceptance-criteria']
        ? { acceptanceCriteria: String(flags['acceptance-criteria']) }
        : {}),
      ...(flags['available-tools'] ? { availableTools: String(flags['available-tools']) } : {}),
      ...(forHuman !== undefined ? { forHuman } : {}),
      delegate: resolveProtocolTicketDelegate(flags, modelIdentifier, agentIdentifier)
    };

    const data = await apiPost(
      platformUrl,
      bearerToken,
      localSecret,
      organizationId,
      '/api/protocol/create-ticket',
      body,
      timeoutMs
    );
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Standalone mode: resolve project from cwd/--working-directory first, then create draft ticket.
  if (sessionKey || ticketId) {
    throw new Error(
      'Provide both --session-key and --ticket-id for follow-up create, or provide neither for standalone create.'
    );
  }

  const standaloneWorkingDirectory =
    !flags.personal && !flags['project-id']
      ? String(flags['working-directory'] ?? process.cwd())
      : undefined;

  const standaloneBody = {
    ...objectiveInput,
    ...(flags.personal ? { personal: true } : {}),
    ...(!flags.personal && flags['project-id'] ? { projectId: String(flags['project-id']) } : {}),
    ...(standaloneWorkingDirectory ? { workingDirectory: standaloneWorkingDirectory } : {}),
    ...(flags.title ? { title: String(flags.title) } : {}),
    ...(flags.priority ? { priority: String(flags.priority) } : {}),
    ...(flags['acceptance-criteria']
      ? { acceptanceCriteria: String(flags['acceptance-criteria']) }
      : {}),
    ...(flags['available-tools'] ? { availableTools: String(flags['available-tools']) } : {}),
    ...(forHuman !== undefined ? { forHuman } : {}),
    delegate: resolveProtocolTicketDelegate(flags, modelIdentifier, agentIdentifier)
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/tickets',
    standaloneBody,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// record-work (one-shot: create ticket in review + completed objective + feed post)
// ---------------------------------------------------------------------------

async function protocolRecordWork(args) {
  const flags = parseFlags(args);

  if (flags['payload-file'] && flags['payload-json']) {
    throw new Error('Use either --payload-file or --payload-json, not both');
  }
  const payload = flags['payload-file']
    ? await readJsonFileOrStdin(String(flags['payload-file']), '--payload-file')
    : flags['payload-json']
      ? parseJsonFlag('--payload-json', flags['payload-json'])
      : null;

  if (payload && (flags.summary || flags['summary-file'])) {
    throw new Error('Use either payload input or --summary/--summary-file, not both');
  }
  if (payload && (flags['objectives-json'] || flags['objectives-file'])) {
    throw new Error('Use either payload input or --objectives-json/--objectives-file, not both');
  }

  const objectiveInput = await resolveObjectivesInput(flags, { payload });

  const summary = payload
    ? (() => {
        const value = payload.summary;
        if (typeof value !== 'string' || !value.trim()) {
          throw new Error('payload input must include a non-empty summary');
        }
        return value;
      })()
    : flags['summary-file']
      ? await readTextFileOrStdin(String(flags['summary-file']), '--summary-file')
      : requireFlag(flags, 'summary', undefined);

  let artifacts = payload?.artifacts ?? [];
  if (payload && (flags['artifacts-file'] || flags['artifacts-json'])) {
    throw new Error('Use either payload input or artifact flags, not both');
  }
  if (flags['artifacts-file']) {
    artifacts = await readJsonFileOrStdin(String(flags['artifacts-file']), '--artifacts-file');
  } else if (flags['artifacts-json']) {
    artifacts = parseJsonFlag('--artifacts-json', flags['artifacts-json']);
  }

  if (payload && (flags['change-rationales-file'] || flags['change-rationales-json'])) {
    throw new Error('Use either payload input or change-rationale flags, not both');
  }
  const changeRationales = payload?.changeRationales ?? (await resolveChangeRationales(flags));

  // record-work has no live session, but the same git-changed-files guard
  // helps catch missing rationales. Apply the same opt-out semantics as deliver.
  validateDeliverFileChanges(flags, changeRationales);

  const personal = Boolean(flags.personal);
  const workingDirectory =
    flags['working-directory'] ?? (!flags['project-id'] && !personal ? process.cwd() : undefined);

  const agentIdentifier = resolveProtocolAgentIdentifier(flags);
  const modelIdentifier = resolveProtocolModelIdentifier(flags);

  const body = {
    ...objectiveInput,
    summary,
    artifacts,
    changeRationales,
    agentIdentifier,
    connectionMethod: String(flags.method ?? 'cli'),
    metadata: await resolveProtocolMetadata(flags, { cwd: process.cwd() }),
    ...(flags.title ? { title: String(flags.title) } : {}),
    ...(flags.priority ? { priority: String(flags.priority) } : {}),
    ...(flags['project-id'] ? { projectId: String(flags['project-id']) } : {}),
    ...(personal ? { personal: true } : {}),
    ...(workingDirectory ? { workingDirectory: String(workingDirectory) } : {}),
    ...(flags['acceptance-criteria']
      ? { acceptanceCriteria: String(flags['acceptance-criteria']) }
      : {}),
    ...(flags['available-tools'] ? { availableTools: String(flags['available-tools']) } : {}),
    delegate: resolveProtocolTicketDelegate(flags, modelIdentifier, agentIdentifier)
  };

  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/record-work',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));

  const ticketId = data.ticket?.ticket_id ?? data.ticket?.id ?? data.ticket?.ticketId;
  if (ticketId) {
    process.stderr.write(`\nTICKET_ID=${ticketId}\n`);
  }
}

// ---------------------------------------------------------------------------
// add-objectives (append ordered objectives to an existing ticket)
// ---------------------------------------------------------------------------

async function protocolAddObjectives(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', process.env.TICKET_ID);
  const objectiveInput = await resolveObjectivesInput(flags, { requireSingleObjective: false });
  if (!objectiveInput.objectives) {
    throw new Error('add-objectives requires --objectives-json or --objectives-file');
  }
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags, ticketId);
  const timeoutMs = resolveTimeout(flags);

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/add-objectives',
    {
      ticketId,
      objectives: objectiveInput.objectives
    },
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// search-tickets (find tickets by query/status/project/created_by/dates)
// ---------------------------------------------------------------------------

async function protocolSearchTickets(args) {
  const flags = parseFlags(args);
  const { platformUrl, bearerToken, localSecret, organizationId } =
    await resolveProtocolAuthForFlags(flags);
  const timeoutMs = resolveTimeout(flags);

  const statuses = flags.status
    ? String(flags.status)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : undefined;

  const body = {
    ...(flags.query ? { query: String(flags.query) } : {}),
    ...(statuses?.length ? { statuses } : {}),
    ...(flags['include-completed'] !== undefined
      ? {
          includeCompleted:
            flags['include-completed'] !== false && flags['include-completed'] !== 'false'
        }
      : {}),
    ...(flags.limit ? { limit: parseInt(String(flags.limit), 10) } : {}),
    ...(flags['project-id'] ? { projectId: String(flags['project-id']) } : {}),
    ...(flags['created-by'] ? { createdBy: String(flags['created-by']) } : {}),
    ...(flags['updated-after'] ? { updatedAfter: String(flags['updated-after']) } : {}),
    ...(flags['updated-before'] ? { updatedBefore: String(flags['updated-before']) } : {})
  };

  const data = await apiPost(
    platformUrl,
    bearerToken,
    localSecret,
    organizationId,
    '/api/protocol/search-tickets',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// auth-status (agent-friendly auth diagnostics)
// ---------------------------------------------------------------------------

async function protocolAuthStatus() {
  const status = await getAuthStatus();

  console.log(
    JSON.stringify(
      {
        ok: status.isLoggedIn,
        authStatus: {
          isLoggedIn: status.isLoggedIn,
          platformUrl: status.platformUrl,
          platformUrlSource: status.platformUrlSource,
          tokenSource: status.tokenSource,
          tokenPresent: status.tokenPresent,
          organizationId: status.organizationId,
          authMode: status.authMode,
          error: status.error,
          hasLocalSecret: status.hasLocalSecret,
          credentialsFileExists: status.credentialsFileExists,
          electronCredentialsFileExists: status.electronCredentialsFileExists
        }
      },
      null,
      2
    )
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function runProtocolCommand(subcommand, args) {
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    console.log(`ovld protocol <subcommand> [flags]

Use this for ticket lifecycle work from an agent runtime: create a standalone
draft with \`ovld protocol create\`, create-and-attach with \`ovld protocol prompt\`,
or attach to an existing ticket with \`ovld protocol attach --ticket-id <ticket_id>\`.

Project discovery:
  When prompting or creating tickets, the CLI automatically resolves the correct
  project by matching your current working directory against your configured
  "Local working directory" for that project (stored per user in Overlord).
  You can also discover the project explicitly:

    ovld protocol discover-project
    ovld protocol discover-project --project-id <project-uuid>
    ovld protocol discover-project --working-directory /path/to/repo

  Use --project-id to override automatic resolution on discover, prompt, or ticket creation.
  Use --personal to create a private ticket without assigning any project.

Subcommands:
  auth-status               Return machine-readable auth status for agent runtimes
  discover-project          Resolve a project from the current working directory
  attach                    Start a ticket session and return full working context
  connect                   Start a lightweight session without full context
  load-context              Read ticket context without creating a session
  revert                    Restore the local working tree to an objective checkpoint
  search-tickets            Find tickets by keyword, status, project, creator, or update date
  discuss-objective          Mark a draft objective as submitted (ready for review/execution)
  add-objectives             Append ordered objectives to an existing ticket
  create                    Create a draft ticket without attaching (follow-up or standalone)
  prompt                    Create a ticket and attach to it immediately
  record-work               Record completed-from-chat work as a ticket in review + feed post (no attach)
  update                    Post progress, activity events, and optional change rationales
  heartbeat                 Send a lightweight liveness ping without creating a ticket event
  record-change-rationales  Persist structured change rationales without a progress update
  ask                       Post a blocking question and move the ticket to review
  request-approval-gate     Flip auto_advance=false on the next queued future objective
  request-execution         Queue an objective for local/remote runner execution
  claim-execution           Claim one queued execution request for this device
  list-organizations        List organizations the authenticated user belongs to
  list-execution-requests   List active execution requests in the runner queue
  clear-execution-requests  Clear active execution requests by objective or wholesale
  complete-execution-launch Mark a claimed execution request launched
  fail-execution-launch     Mark a claimed execution request failed
  permission-request        Notify Overlord that the agent is requesting tool permission
  hook-event                Record a lifecycle hook event without a session key
  read-context              Read shared persistent context for this ticket
  write-context             Write shared persistent context for future sessions
  deliver                     Finish work, send artifacts, and move the ticket to review
  attachment-list             List objective attachments visible to the current session
  attachment-prepare-upload   Get a signed upload URL for an objective attachment
  attachment-finalize-upload  Finalize an uploaded attachment row after storage upload
  attachment-download-url     Get a signed download URL for an existing attachment
  attachment-upload-file      Prepare, upload, and finalize a local file in one command
  get-device                  Identify / register the current device and return its label
  update-device               Rename this device's label (must be lowercase kebab-case)
  list-project-resources      List resource directories registered for a project
  add-project-resource        Register a local directory as a project resource on this device
  update-project-resource     Update a resource directory's path, label, or primary status

Environment fallback:
  --session-key  <- SESSION_KEY or auto-persisted session from last attach/connect/prompt in this working directory
  --ticket-id    <- TICKET_ID  or auto-persisted session (human-readable ticket_id, e.g. 1:899)
  auth/host     <- OVERLORD_URL, OVERLORD_AGENT_TOKEN (durable; best for headless/CI), optional OVERLORD_ACCESS_TOKEN + OVERLORD_ORGANIZATION_ID, or shared OAuth credentials from ovld auth/Desktop login
  --timeout     <- OVERLORD_TIMEOUT

Common flags:
  --timeout <ms>              Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})
  --ticket-id <ticket_id>     Ticket identifier (e.g. 1:899) when the subcommand operates on an existing ticket
  --organization-id <id>      Legacy organization override for UUID ticket ids; inferred from ticket_id when possible
  --session-key <key>         Session key returned by attach/connect/prompt
  --agent <identifier>        Agent identifier sent to Overlord (default: AGENT_IDENTIFIER or claude-code)
  --model <identifier>        Model identifier to snapshot on executing objectives
  --method <connectionMethod> Connection method sent to Overlord (default: cli)
  --snapshot-json <json>      Snapshot metadata to attach to sessions/file changes
  --snapshot-file <path|->    Read snapshot metadata JSON from a file or stdin

auth-status:
  Purpose:
    Check whether the local runtime has usable Overlord credentials.
  Returns:
    JSON with ok=true|false plus authStatus fields describing token and host sources.

discover-project:
  Purpose:
    Resolve the Overlord project that corresponds to the current (or given) working directory.
    Uses the caller's configured "Local working directory" for matching.
  Optional:
    --project-id <uuid>       Resolve this project directly; skips working-directory matching
    --working-directory <path>  Directory to match (default: current working directory)
    --device-fingerprint <fp>   Prefer resource directories for this registered device
    --device-hostname <name>    Register/update device metadata when fingerprint is provided
    --device-platform <platform>
  Returns:
    Project JSON with id, name, organizationId. Prints PROJECT_ID=<id> on stderr.
  Notes:
    Set your local working directory for a project in the Overlord UI under Project Settings.
    When no match is found, returns a 404 with a hint.

attach:
  Purpose:
    Create the working session for an agent on an existing ticket. This is the normal first call.
  Required:
    --ticket-id <ticket_id>   Human-readable identifier (e.g. 1:899). Also accepts UUID.
  Optional:
    --agent <identifier>
    --model <identifier>
    --method <connectionMethod>
    --external-session-id <id|null>  Store the native agent thread/session id, or clear it with null
    --metadata-json <json>     Extra session metadata object
    --skip-checkpoint          Bypass automatic objective-start git checkpoint creation
  Returns:
    Full JSON including session.sessionKey, ticket, history, artifacts, sharedState, and promptContext
  Notes:
    If --external-session-id is omitted, the CLI may auto-detect Codex or Claude session ids
    Attach creates and records missing local git checkpoints for executing objectives before work starts.

connect:
  Purpose:
    Create a lightweight session when you only need a session key and not the full ticket payload
  Required:
    --ticket-id <ticket_id>   Human-readable identifier (e.g. 1:899). Also accepts UUID.
  Optional:
    --agent <identifier>
    --model <identifier>
    --method <connectionMethod>
    --metadata-json <json>     Extra session metadata object
  Returns:
    Session JSON and SESSION_KEY on stderr when available

load-context:
  Purpose:
    Read ticket details without creating a session
  Required:
    --ticket-id <ticket_id>

revert:
  Purpose:
    Fetch an objective checkpoint from Overlord and restore the local git working tree to it.
  Required:
    --objective-id <objective-uuid>
  Optional:
    --working-directory <path>  Repository to restore (default: current working directory)
  Notes:
    A safety snapshot of the current working tree is saved under refs/overlord/safety/ first.

search-tickets:
  Purpose:
    Find tickets in your organization by keyword, status, project, creator, or update window.
    Omit --query to list mode (most recently updated first).
  Optional:
    --query <text>             Free-text search across the ticket search vector + title fallback
    --status <csv>             Comma-separated statuses, e.g. "draft,next-up,execute"
    --include-completed <bool> Include completed tickets (default: false)
    --limit <n>                Max results 1..50 (default: 8)
    --project-id <uuid>        Restrict to a single project
    --created-by <uuid>        Restrict to tickets created by this user
    --updated-after <iso>      Updated_at >= ISO timestamp
    --updated-before <iso>     Updated_at <= ISO timestamp
  Returns:
    JSON with { tickets, count }.

update:
  Purpose:
    Post progress or activity events during execution
  Required:
    --session-key <key>
    --ticket-id <ticket_id>
    --summary <text> or --summary-file <path|->
  Optional:
    --phase <status>          draft | execute | review | deliver | complete | blocked | cancelled
    --event-type <type>       update | user_follow_up | alert | discussion_summary | decision
    --begin-follow-up-work    Explicitly reopen a delivered/review ticket for execution
    --follow-up-intent <mode> discussion | execution | pending_delivery
    --payload-json <json>     Additional structured payload, for example notifications
    --external-url <url|null> Store or clear a deep link to the live agent session
    --external-session-id <id|null>
    --change-rationales-json <json>
    --change-rationales-file <path>
  Notes:
    Use phase=execute while actively working. For delivered/review tickets, pass
    --begin-follow-up-work before moving back to execute. user_follow_up is for
    verbatim human follow-up messages; discussion_summary and decision record
    important non-file follow-up outcomes. After a prior delivery, execution
    updates, git snapshots, change rationales, or explicit pending_delivery
    intent mark the objective as pending_delivery so redelivery is required
    only when follow-up execution produced work.
    Pass --summary-file - to read the summary from stdin — avoids shell interpretation of backticks,
    quotes, or other special characters in the summary text.

heartbeat:
  Purpose:
    Send a lightweight liveness ping for an attached session without adding activity-feed noise
  Required:
    --session-key <key>
    --ticket-id <ticket_id>
  Optional:
    --phase <status>          draft | execute | review | deliver | complete | blocked | cancelled
    --percent <0-100>         Optional percent-complete hint for transient UI progress
    --note <text>             Optional short note, e.g. "Running the integration suite"
    --external-url <url|null> Store or clear a deep link to the live agent session
    --external-session-id <id|null>
  Notes:
    Heartbeat only updates session liveness plus transient telemetry on the session row.
    It does not create a ticket event and should be used when you are still working but have
    nothing meaningful to post via update.

record-change-rationales:
  Purpose:
    Persist structured file-change rationale records without also posting a normal update
  Required:
    --session-key <key>
    --ticket-id <ticket_id>
    --change-rationales-json <json> or --change-rationales-file <path>
  Optional:
    --summary <text> or --summary-file <path|->
    --phase <status>

ask:
  Purpose:
    Raise a blocking question for a human reviewer/PM
  Required:
    --session-key <key>
    --ticket-id <ticket_id>
    --question <text> or --question-file <path|->
  Optional:
    --phase <status>
    --payload-json <json>
  Notes:
    After ask succeeds, stop working until the human responds

permission-request:
  Purpose:
    Notify Overlord that the local agent runtime is requesting tool permission.
    This is primarily used by installed permission hooks.
  Required:
    --ticket-id <ticket_id>
  Optional:
    --payload-file <path|->   Hook JSON payload, or stdin when "-"

hook-event:
  Purpose:
    Record a lifecycle hook event for a ticket without requiring a session key.
    This is primarily used by installed UserPromptSubmit hooks. Stop is reserved for future lifecycle hooks.
  Required:
    --hook-type <UserPromptSubmit|Stop>
    --ticket-id <ticket_id>
  Optional:
    --prompt <text>
    --turn-index <n>
    --follow-up-intent <mode> discussion | execution | pending_delivery

read-context:
  Purpose:
    Read persistent shared context written by earlier sessions
  Required:
    --session-key <key>
    --ticket-id <ticket_id>
  Optional:
    --query <text>            Filter by key substring
    --limit <n>               Max entries to return

write-context:
  Purpose:
    Save shared facts for future sessions
  Required:
    --session-key <key>
    --ticket-id <ticket_id>
    --key <name>
    --value <json-or-string>  Parsed as JSON first; stored as a string if JSON parsing fails
  Optional:
    --tags <csv>

deliver:
  Purpose:
    Conclude the session and submit the final narrative plus artifacts/change rationales
  Required:
    --session-key <key>
    --ticket-id <ticket_id>
    --summary <text> or --summary-file <path|->
    or: --payload-json <json>
    or: --payload-file <path|-> containing { summary, artifacts, changeRationales }
  Optional:
    --artifacts-json <json>
    --artifacts-file <path|->
    --change-rationales-json <json>
    --change-rationales-file <path|->
    --skip-file-change-check  Bypass local git vs changeRationales validation
  Notes:
    Use --payload-json when the full delivery JSON fits comfortably inline.
    Use --payload-file - to read the full delivery JSON from stdin without creating a scratch file.
    Use --summary-file - to pipe just the summary text via stdin (avoids shell special-char issues).
    Do not combine --payload-json/--payload-file with --summary/--summary-file, --artifacts-json/--artifacts-file, or change-rationale flags.
    In a git workspace, deliver validates that changed files are represented by changeRationales unless skipped.

prompt:
  Purpose:
    Create a ticket and attach to it in one call.
    When --project-id is omitted, automatically resolves the project from the
    current working directory (matching against the caller's project resource directories).
  Required:
    --objective <text>
    or: --objectives-json <json> / --objectives-file <path|-> with [{ "objective": "...", "title": "...", "autoAdvance": true }]
  Optional:
    --title <text>
    --priority <level>        low | medium | high | urgent
    --project-id <id>         Explicit project; skips working-directory resolution
    --personal                Create the ticket without assigning a project
    --working-directory <path> Override cwd for project resolution (default: cwd)
    --acceptance-criteria <text>
    --available-tools <text>
    --for-human               Mark the new ticket as requiring a human
    --execution-target <t>    Deprecated alias: agent | human
    --delegate <model>        Model or delegate identifier that created the ticket
    --parent-session-key <key>
    --parent-ticket-id <ticket_id>
    --agent <identifier>
    --model <identifier>
    --method <connectionMethod>
    --metadata-json <json>     Extra session metadata object
  Returns:
    New ticket/session JSON plus SESSION_KEY and TICKET_ID on stderr when available

discuss-objective:
  Purpose:
    Mark the latest draft objective on a ticket as "submitted", indicating the objective
    has been discussed and is ready for review or execution. Does NOT start execution —
    use \`attach\` to begin execution.
  Required:
    --ticket-id <ticket_id>
  Optional:
    --objective-id <id>       Target a specific draft objective by UUID

create:
  Purpose:
    Create a draft ticket without attaching to it.
    If session flags are provided, creates a follow-up draft linked to the current ticket.
    If session flags are omitted, resolves project by working directory and creates a standalone draft.
  Required:
    --objective <text>
    or: --objectives-json <json> / --objectives-file <path|-> with [{ "objective": "...", "title": "...", "autoAdvance": true }]
  Optional:
    --session-key <key>
    --ticket-id <ticket_id>
    --working-directory <path>  Resolve project by your configured local working directory (default: cwd)
    --project-id <id>           Explicit project for standalone draft creation
    --personal                  Create a private standalone draft without a project
    --title <text>
    --priority <level>        low | medium | high | urgent
    --acceptance-criteria <text>
    --available-tools <text>
    --for-human               Mark the new ticket as requiring a human
    --execution-target <t>    Deprecated alias: agent | human
    --delegate <model>        Model or delegate identifier that created the ticket
    --agent <identifier>
    --model <identifier>
  Returns:
    New draft ticket JSON (follow-up draft when session flags are provided)
  Notes:
    Standalone create auto-discovers the project from the current working directory unless --personal is set.
    Follow-up create requires both --session-key and --ticket-id.
    Use create for future work. If the work is already complete and only needs to be recorded,
    use \`record-work\` instead.

add-objectives:
  Purpose:
    Append ordered objectives to an existing ticket. Index 0 is the first newly
    added objective to execute; later indexes queue after it.
  Required:
    --ticket-id <ticket_id>
    --objectives-json <json> or --objectives-file <path|->
  Notes:
    Use this when each prompt is a sequential step toward the same feature or
    goal. Create multiple tickets instead when prompts describe different
    features or goals.

record-work:
  Purpose:
    Record work the agent already completed in a chat as a ticket in \`review\` status
    with a completed objective, then trigger the feed-post generator. No session is
    left open — use this INSTEAD OF \`create\` + \`attach\` + \`deliver\` for "log what we
    just did" flows. Do NOT use this for in-progress work; use \`prompt\` for that.
  Required:
    --objective <text> or --objective-file <path|->   What was asked / what was done
    or: --objectives-json <json> / --objectives-file <path|->
    --summary   <text> or --summary-file   <path|->   Narrative for feed post + reviewer
    or: --payload-json <json>
    or: --payload-file <path|-> containing { objective, summary, artifacts, changeRationales }
  Optional:
    --title <text>            Auto-derived from objective if omitted
    --priority <level>        low | medium | high | urgent
    --project-id <id>         Skip cwd resolution and use this project explicitly
    --working-directory <path> Override cwd for project resolution
    --personal                Create a private ticket when no project should be associated
    --artifacts-json <json>
    --artifacts-file <path|->
    --change-rationales-json <json>
    --change-rationales-file <path|->
    --skip-file-change-check  Bypass local git vs changeRationales validation
    --acceptance-criteria <text>
    --available-tools <text>
    --delegate <model>
    --agent <identifier>
    --model <identifier>
  Notes:
    Project resolution mirrors \`prompt\`: if --project-id is not set and --personal is not used,
    the CLI sends cwd as workingDirectory and the API matches it against your configured
    project_resource_directories rows. If no match, the API returns 400 — re-run with
    --project-id <id> or --personal.
    Use this for completed-from-chat work. If you still need to execute the work, use \`create\`
    for a draft ticket or \`prompt\` to create and start execution immediately.
    In a git workspace, record-work validates that changed files are represented by
    changeRationales unless --skip-file-change-check is set.

attachment-list:
  Required:
    --session-key <key>
    one of: --objective-id <id> | --ticket-id <ticket_id>
  Optional:
    --objective-id <id>       Filter to a single objective (also acts as ticket scope)
    --ticket-id <ticket_id>   List every attachment for a ticket
  Returns:
    JSON array of { id, label, content_type, file_size, objective_id, storage_path, created_at }

attachment-prepare-upload:
  Required:
    --session-key <key>
    --objective-id <id>
    --file-name <name>
  Optional:
    --ticket-id <ticket_id>   Derived from --objective-id when omitted
    --label <text>
    --content-type <mime>
    --file-size <bytes>
    --metadata-json <json>

attachment-finalize-upload:
  Required:
    --session-key <key>
    --objective-id <id>
    --storage-path <path>
    --label <text>
  Optional:
    --ticket-id <ticket_id>   Derived from --objective-id when omitted
    --content-type <mime>
    --file-size <bytes>
    --metadata-json <json>

attachment-download-url:
  Required:
    --session-key <key>
    one of: --attachment-id <id> | --storage-path <path>
  Optional:
    --ticket-id <ticket_id>   Derived from --attachment-id / --objective-id when omitted
    --objective-id <id>       Required when using --storage-path
    --expires-in <seconds>

attachment-upload-file:
  Required:
    --session-key <key>
    --objective-id <id>
    --file <path>
  Optional:
    --ticket-id <ticket_id>   Derived from --objective-id when omitted
    --file-name <name>        Defaults to basename of --file
    --label <text>            Defaults to file name
    --content-type <mime>     Defaults to application/octet-stream
    --metadata-json <json>

get-device:
  Required:
    --device-fingerprint <fp>  (or OVERLORD_DEVICE_FINGERPRINT env var)
  Optional:
    --device-hostname <name>
    --device-platform <platform>  (darwin|linux|windows)
    --device-port <port>          SSH port for placeholder reconciliation

update-device:
  Required:
    --device-fingerprint <fp>  (or OVERLORD_DEVICE_FINGERPRINT env var)
    --label <label>            Lowercase kebab-case, unique within org

list-project-resources:
  Required:
    --project-id <uuid>
  Optional:
    --device-fingerprint <fp>  Filter to current device only

add-project-resource:
  Required:
    --project-id <uuid>
    --device-fingerprint <fp>  (or OVERLORD_DEVICE_FINGERPRINT env var)
  Optional:
    --directory <path>         Defaults to current working directory
    --label <text>
    --is-primary               Mark as primary directory for this device+project
    --device-hostname <name>
    --device-platform <platform>
    --device-port <port>       SSH port for placeholder reconciliation

update-project-resource:
  Required:
    --resource-id <uuid>       From list-project-resources output
    --device-fingerprint <fp>  (or OVERLORD_DEVICE_FINGERPRINT env var)
  Optional:
    --directory <path>         New absolute path
    --label <text>             New label (pass 'null' to clear)
    --is-primary <true|false>

request-execution:
  Required:
    --ticket-id <ticket_id>
  Optional:
    --objective-id <uuid>
    --requested-from <source>  manual_run | auto_advance | api | ssh
    --idempotency-key <key>
    --agent <agent>
    --model <model>
    --thinking <level>
    --flag <value>             Extra agent flag (repeatable)
    --working-directory <path>
    --ssh-command <command>
    --remote-working-directory <path>
    --server-multiplexer <none|tmux>
    --target-kind <any|local|ssh>
    --target-device-id <uuid>
    --target-resource-id <uuid>

claim-execution:
  Required:
    --device-fingerprint <fp>  (or OVERLORD_DEVICE_FINGERPRINT env var)
  Optional:
    --device-hostname <name>
    --device-platform <platform>
    --lease-seconds <n>
    --project-id <uuid>

list-organizations:
  Purpose:
    Print every organization the authenticated user (or agent token) belongs to.
    The runner uses this to poll all of your organizations, not just the one
    stored at login. Takes no required flags.

list-execution-requests:
  Purpose:
    List active execution requests ('queued', 'claimed', 'launching') visible to
    the caller. When --device-fingerprint is provided, queued rows are filtered
    to work this execution target could claim and in-flight rows are limited to
    rows already claimed by this target.
  Optional:
    --device-fingerprint <fp>  Filter queue visibility to one execution target
    --project-id <uuid>        Restrict to one project

clear-execution-requests:
  Purpose:
    Clear active execution requests from the runner queue by marking them failed.
  Required:
    --objective-id <uuid>      Clear one objective's active request
    or: --clear-all            Clear every active request visible to the caller
  Optional:
    --project-id <uuid>        Restrict clear-all to one project

complete-execution-launch:
  Required:
    --request-id <uuid>        (or EXECUTION_REQUEST_ID env var)
    --device-fingerprint <fp>  (or OVERLORD_DEVICE_FINGERPRINT env var)
  Optional:
    --launched-session-id <uuid>

fail-execution-launch:
  Required:
    --request-id <uuid>        (or EXECUTION_REQUEST_ID env var)
    --device-fingerprint <fp>  (or OVERLORD_DEVICE_FINGERPRINT env var)
    --error <message>

Examples:
  ovld protocol auth-status
  ovld protocol discover-project
  ovld protocol discover-project --project-id <project-uuid>
  ovld protocol discover-project --working-directory /path/to/repo
  ovld protocol prompt --agent codex --objective "Implement feature X"   # auto-resolves project from cwd
  ovld protocol attach --ticket-id 1:899
  ovld protocol attach --ticket-id 1:899 --external-session-id null
  ovld protocol connect --ticket-id 1:899
  ovld protocol load-context --ticket-id 1:899
  ovld protocol revert --objective-id <objective-uuid>
  ovld protocol search-tickets --query "auth refactor" --status next-up,execute --limit 10
  ovld protocol discuss-objective --ticket-id 1:899
  ovld protocol discuss-objective --ticket-id 1:899 --objective-id <objective-uuid>
  ovld protocol add-objectives --ticket-id 1:899 --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'
  ovld protocol create --agent codex --objective "Capture follow-up work from this repo"
  ovld protocol create --agent codex --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'
  ovld protocol create --agent codex --session-key <key> --ticket-id <ticket_id> --objective "Capture follow-up work"
  ovld protocol prompt --agent codex --objective "Implement user auth" --priority high
  ovld protocol update --session-key <key> --ticket-id <ticket_id> --summary "Did X" --phase execute
  ovld protocol update --session-key <key> --ticket-id <ticket_id> --summary-file ./update.txt --event-type user_follow_up
  ovld protocol record-change-rationales --session-key <key> --ticket-id <ticket_id> --change-rationales-json '[{"label":"...","file_path":"...","summary":"...","why":"...","impact":"...","hunks":[{"header":"@@ ... @@"}]}]'
  ovld protocol ask --session-key <key> --ticket-id <ticket_id> --question-file ./question.txt
  ovld protocol hook-event --hook-type UserPromptSubmit --ticket-id <ticket_id> --prompt "User follow-up" --turn-index 1
  ovld protocol read-context --session-key <key> --ticket-id <ticket_id> --query arch --limit 5
  ovld protocol write-context --session-key <key> --ticket-id <ticket_id> --key "arch" --value '"monorepo"' --tags repo,agent
  ovld protocol attachment-list --session-key <key> --objective-id <objective-id>
  ovld protocol attachment-prepare-upload --session-key <key> --objective-id <objective-id> --file-name spec.pdf --content-type application/pdf
  ovld protocol attachment-upload-file --session-key <key> --objective-id <objective-id> --file ./spec.pdf
  ovld protocol attachment-download-url --session-key <key> --attachment-id <attachment-id>
  ovld protocol request-execution --ticket-id 1:899 --agent codex --requested-from manual_run
  ovld protocol claim-execution --device-fingerprint $OVERLORD_DEVICE_FINGERPRINT
  ovld protocol list-organizations
  ovld protocol list-execution-requests --device-fingerprint $OVERLORD_DEVICE_FINGERPRINT
  ovld protocol clear-execution-requests --objective-id <objective-uuid>
  ovld protocol clear-execution-requests --clear-all
  ovld protocol deliver --session-key <key> --ticket-id <ticket_id> --summary "Done"
  ovld protocol deliver --session-key <key> --ticket-id <ticket_id> --summary "Done" --artifacts-file ./artifacts.json
  ovld protocol deliver --session-key <key> --ticket-id <ticket_id> --payload-json '{"summary":"Done","artifacts":[{"type":"note","label":"Delivery","content":"..."}]}'
  ovld protocol deliver --session-key <key> --ticket-id <ticket_id> --payload-file .overlord/tmp/deliver.json
  ovld protocol deliver --session-key <key> --ticket-id <ticket_id> --payload-file -
  ovld protocol deliver --session-key <key> --ticket-id <ticket_id> --summary "Done" --skip-file-change-check
  ovld protocol deliver --session-key <key> --ticket-id <ticket_id> --summary "Done" --timeout 60000
  ovld protocol record-work --objective "User asked for X; I did Y" --summary "What I did and why" --change-rationales-json '[...]'
  ovld protocol record-work --payload-file - <<'EOF'
    {"objective":"...","summary":"...","artifacts":[...],"changeRationales":[...]}
EOF
  ovld protocol get-device --device-fingerprint $OVERLORD_DEVICE_FINGERPRINT
  ovld protocol update-device --device-fingerprint $OVERLORD_DEVICE_FINGERPRINT --label work-macbook
  ovld protocol list-project-resources --project-id <project-uuid>
  ovld protocol list-project-resources --project-id <project-uuid> --device-fingerprint $OVERLORD_DEVICE_FINGERPRINT
  ovld protocol add-project-resource --project-id <project-uuid> --device-fingerprint $OVERLORD_DEVICE_FINGERPRINT
  ovld protocol add-project-resource --project-id <project-uuid> --directory /path/to/repo --device-fingerprint $OVERLORD_DEVICE_FINGERPRINT --label "main checkout" --is-primary
  ovld protocol update-project-resource --resource-id <resource-uuid> --device-fingerprint $OVERLORD_DEVICE_FINGERPRINT --label "docs branch"
  ovld protocol update-project-resource --resource-id <resource-uuid> --device-fingerprint $OVERLORD_DEVICE_FINGERPRINT --is-primary true
`);
    return;
  }

  if (subcommand === 'discover-project') {
    await protocolDiscoverProject(args);
    return;
  }
  if (subcommand === 'auth-status') {
    await protocolAuthStatus();
    return;
  }
  if (subcommand === 'attach') {
    await protocolAttach(args);
    return;
  }
  if (subcommand === 'connect') {
    await protocolConnect(args);
    return;
  }
  if (subcommand === 'load-context') {
    await protocolLoadContext(args);
    return;
  }
  if (subcommand === 'revert') {
    await protocolRevert(args);
    return;
  }
  if (subcommand === 'search-tickets') {
    await protocolSearchTickets(args);
    return;
  }
  if (subcommand === 'discuss-objective') {
    await protocolDiscussObjective(args);
    return;
  }
  if (subcommand === 'add-objectives') {
    await protocolAddObjectives(args);
    return;
  }
  if (subcommand === 'create' || subcommand === 'create-ticket') {
    await protocolCreateTicket(args);
    return;
  }
  if (subcommand === 'prompt' || subcommand === 'spawn') {
    await protocolPrompt(args);
    return;
  }
  if (subcommand === 'record-work') {
    await protocolRecordWork(args);
    return;
  }
  if (subcommand === 'attachment-list') {
    await protocolAttachmentList(args);
    return;
  }
  if (subcommand === 'attachment-prepare-upload') {
    await protocolAttachmentPrepareUpload(args);
    return;
  }
  if (subcommand === 'attachment-finalize-upload') {
    await protocolAttachmentFinalizeUpload(args);
    return;
  }
  if (subcommand === 'attachment-download-url') {
    await protocolAttachmentGetDownloadUrl(args);
    return;
  }
  if (subcommand === 'attachment-upload-file') {
    await protocolAttachmentUploadFile(args);
    return;
  }
  if (subcommand === 'update') {
    await protocolUpdate(args);
    return;
  }
  if (subcommand === 'heartbeat') {
    await protocolHeartbeat(args);
    return;
  }
  if (subcommand === 'record-change-rationales') {
    await protocolRecordChangeRationales(args);
    return;
  }
  if (subcommand === 'ask') {
    await protocolAsk(args);
    return;
  }
  if (subcommand === 'request-approval-gate') {
    await protocolRequestApprovalGate(args);
    return;
  }
  if (subcommand === 'request-execution') {
    await protocolRequestExecution(args);
    return;
  }
  if (subcommand === 'claim-execution') {
    await protocolClaimExecution(args);
    return;
  }
  if (subcommand === 'list-organizations') {
    await protocolListOrganizations(args);
    return;
  }
  if (subcommand === 'list-execution-requests') {
    await protocolListExecutionRequests(args);
    return;
  }
  if (subcommand === 'clear-execution-requests') {
    await protocolClearExecutionRequests(args);
    return;
  }
  if (subcommand === 'complete-execution-launch') {
    await protocolCompleteExecutionLaunch(args);
    return;
  }
  if (subcommand === 'fail-execution-launch') {
    await protocolFailExecutionLaunch(args);
    return;
  }
  if (subcommand === 'permission-request') {
    await protocolPermissionRequest(args);
    return;
  }
  if (subcommand === 'hook-event') {
    await protocolHookEvent(args);
    return;
  }
  if (subcommand === 'read-context') {
    await protocolReadContext(args);
    return;
  }
  if (subcommand === 'write-context') {
    await protocolWriteContext(args);
    return;
  }
  if (subcommand === 'deliver') {
    await protocolDeliver(args);
    return;
  }
  if (subcommand === 'get-device') {
    await protocolGetDevice(args);
    return;
  }
  if (subcommand === 'update-device') {
    await protocolUpdateDevice(args);
    return;
  }
  if (subcommand === 'list-project-resources') {
    await protocolListProjectResources(args);
    return;
  }
  if (subcommand === 'add-project-resource') {
    await protocolAddProjectResource(args);
    return;
  }
  if (subcommand === 'update-project-resource') {
    await protocolUpdateProjectResource(args);
    return;
  }

  console.error(`Unknown protocol subcommand: ${subcommand}\n`);
  console.log('Run: ovld protocol help');
  process.exit(1);
}
