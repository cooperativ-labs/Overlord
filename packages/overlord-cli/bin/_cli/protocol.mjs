#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildAuthHeaders, resolveAuth } from './credentials.mjs';

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

/**
 * Default request timeout in milliseconds. Overridable via --timeout flag or
 * OVERLORD_TIMEOUT env var. A bounded timeout prevents indefinite spinner hangs
 * in sandboxed runtimes where deliver requests can stall without a connection error.
 */
const DEFAULT_TIMEOUT_MS = 30000;

async function apiPost(platformUrl, token, localSecret, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const requestUrl = `${platformUrl}${path}`;
  const requestStart = Date.now();
  let res;
  try {
    res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(token, localSecret),
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

    const causeCode = (
      typeof error === 'object' &&
      error !== null &&
      'cause' in error &&
      typeof error.cause === 'object' &&
      error.cause !== null &&
      'code' in error.cause
    ) ? String(error.cause.code) : '';

    let hint = 'Check your network and Overlord server settings.';
    if (causeCode === 'ECONNREFUSED') {
      hint = 'Connection refused. Verify Overlord is running and OVERLORD_URL points to the correct port.';
    } else if (causeCode === 'ENOTFOUND') {
      hint = 'Host not found. Verify OVERLORD_URL uses a valid hostname.';
    } else if (causeCode === 'ETIMEDOUT') {
      hint = 'Connection timed out. Verify server availability and local firewall/VPN settings.';
    } else if (requestUrl.includes('localhost') || requestUrl.includes('127.0.0.1')) {
      hint = 'Local server unreachable. Start Overlord (usually http://localhost:3000) or update OVERLORD_URL.';
    }

    throw new Error(
      `Network error calling ${requestUrl}: ${message}${causeCode ? ` (${causeCode})` : ''}\n${hint}`
    );
  }

  const durationMs = Date.now() - requestStart;
  process.stderr.write(`[protocol] ${path} → ${res.status} (${durationMs}ms)\n`);

  const data = await res.json().catch(() => ({}));

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

/** Read SESSION_KEY and TICKET_ID from env if flags not provided */
function resolveSessionFlags(flags) {
  return {
    sessionKey: String(flags['session-key'] ?? process.env.SESSION_KEY ?? ''),
    ticketId: String(flags['ticket-id'] ?? process.env.TICKET_ID ?? '')
  };
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

function requireFlag(flags, name, envAlias) {
  const value = flags[name] ?? (envAlias ? process.env[envAlias] : undefined);
  if (!value) {
    throw new Error(`--${name} is required (or set ${envAlias ?? name.toUpperCase()})`);
  }
  return String(value);
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
    const { readFileSync } = await import('node:fs');
    try {
      return JSON.parse(readFileSync(String(flags['change-rationales-file']), 'utf8'));
    } catch (err) {
      throw new Error(
        `--change-rationales-file: could not read or parse "${flags['change-rationales-file']}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (flags['change-rationales-json']) {
    try {
      return JSON.parse(String(flags['change-rationales-json']));
    } catch {
      throw new Error('--change-rationales-json must be valid JSON');
    }
  }
  return [];
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
  const changedPreview = [...changedFiles].slice(0, 5).join(', ');
  const rationalePreview = rationalePaths.slice(0, 5).join(', ');

  return new Error(
    `${message}\n` +
    `Overlord persists file changes through \`changeRationales\`, not \`file_changes\` artifacts.\n` +
    `Re-run with --change-rationales-json or --change-rationales-file, or pass --skip-file-change-check if this was intentional.` +
    `${changedPreview ? `\nChanged files: ${changedPreview}${changedFiles.size > 5 ? ', ...' : ''}` : ''}` +
    `${rationalePreview ? `\nProvided rationale paths: ${rationalePreview}${rationalePaths.length > 5 ? ', ...' : ''}` : ''}`
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

    const files = fs.readdirSync(sessionsDir)
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
  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const externalSessionId = resolveExternalSessionId(flags);

  const body = {
    ticketId,
    agentIdentifier: String(flags.agent ?? process.env.AGENT_IDENTIFIER ?? 'claude-code'),
    connectionMethod: String(flags.method ?? 'cli'),
    ...(externalSessionId !== undefined ? { externalSessionId } : {}),
    metadata: {}
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/attach',
    body,
    timeoutMs
  );

  const sessionKey = data.session?.sessionKey;
  console.log(JSON.stringify(data, null, 2));

  if (sessionKey) {
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
  const summary = requireFlag(flags, 'summary', undefined);

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const changeRationales = await resolveChangeRationales(flags);

  const externalSessionId = resolveExternalSessionId(flags);

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
    ...(flags['payload-json'] ? { payload: JSON.parse(String(flags['payload-json'])) } : {}),
    ...(changeRationales.length > 0 ? { changeRationales } : {})
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/update',
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

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    changeRationales,
    ...(flags.summary ? { summary: String(flags.summary) } : {}),
    ...(flags.phase ? { phase: String(flags.phase) } : {})
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/change-rationales',
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
  const question = requireFlag(flags, 'question', undefined);

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    question,
    ...(flags.phase ? { phase: String(flags.phase) } : {}),
    ...(flags['payload-json'] ? { payload: JSON.parse(String(flags['payload-json'])) } : {})
  };

  const data = await apiPost(platformUrl, agentToken, localSecret, '/api/protocol/ask', body, timeoutMs);
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// read-context
// ---------------------------------------------------------------------------

async function protocolReadContext(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    ...(flags.query ? { query: String(flags.query) } : {}),
    ...(flags.limit ? { limit: parseInt(String(flags.limit), 10) } : {})
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
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

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    key,
    value,
    ...(flags.tags ? { tags: String(flags.tags).split(',').map(t => t.trim()) } : {})
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
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
  const summary = requireFlag(flags, 'summary', undefined);

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  let artifacts = [];
  if (flags['artifacts-file']) {
    // Load artifacts from a file — avoids shell-escaping issues with large inline JSON bodies
    const { readFileSync } = await import('node:fs');
    try {
      artifacts = JSON.parse(readFileSync(String(flags['artifacts-file']), 'utf8'));
    } catch (err) {
      throw new Error(
        `--artifacts-file: could not read or parse "${flags['artifacts-file']}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else if (flags['artifacts-json']) {
    try {
      artifacts = JSON.parse(String(flags['artifacts-json']));
    } catch {
      throw new Error('--artifacts-json must be valid JSON');
    }
  }

  const changeRationales = await resolveChangeRationales(flags);
  validateDeliverFileChanges(flags, changeRationales);

  const body = {
    sessionKey,
    ticketId,
    summary,
    artifacts,
    ...(changeRationales.length > 0 ? { changeRationales } : {})
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/deliver',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------

async function protocolArtifactPrepareUpload(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const fileName = requireFlag(flags, 'file-name', undefined);

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    fileName,
    ...(flags.label ? { label: String(flags.label) } : {}),
    ...(flags['artifact-type'] ? { artifactType: String(flags['artifact-type']) } : {}),
    ...(flags['content-type'] ? { contentType: String(flags['content-type']) } : {}),
    ...(flags['file-size'] ? { fileSize: parseInt(String(flags['file-size']), 10) } : {}),
    ...(flags['metadata-json'] ? { metadata: JSON.parse(String(flags['metadata-json'])) } : {})
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/artifacts/prepare-upload',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolArtifactFinalizeUpload(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const storagePath = requireFlag(flags, 'storage-path', undefined);
  const label = requireFlag(flags, 'label', undefined);

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    storagePath,
    label,
    ...(flags['artifact-type'] ? { artifactType: String(flags['artifact-type']) } : {}),
    ...(flags['content-type'] ? { contentType: String(flags['content-type']) } : {}),
    ...(flags['file-size'] ? { fileSize: parseInt(String(flags['file-size']), 10) } : {}),
    ...(flags['metadata-json'] ? { metadata: JSON.parse(String(flags['metadata-json'])) } : {})
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/artifacts/finalize-upload',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolArtifactGetDownloadUrl(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  if (!flags['artifact-id'] && !flags['storage-path']) {
    throw new Error('--artifact-id or --storage-path is required');
  }

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = {
    sessionKey,
    ticketId,
    ...(flags['artifact-id'] ? { artifactId: String(flags['artifact-id']) } : {}),
    ...(flags['storage-path'] ? { storagePath: String(flags['storage-path']) } : {}),
    ...(flags['expires-in'] ? { expiresIn: parseInt(String(flags['expires-in']), 10) } : {})
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/artifacts/get-download-url',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

async function protocolArtifactUploadFile(args) {
  const flags = parseFlags(args);
  const { sessionKey, ticketId } = resolveSessionFlags(flags);
  if (!sessionKey) throw new Error('--session-key is required (or set SESSION_KEY)');
  if (!ticketId) throw new Error('--ticket-id is required (or set TICKET_ID)');
  const filePath = requireFlag(flags, 'file', undefined);

  const { readFile, stat } = await import('node:fs/promises');
  const path = await import('node:path');
  const fileName = String(flags['file-name'] ?? path.basename(filePath));
  const contentType = String(flags['content-type'] ?? 'application/octet-stream');
  const label = String(flags.label ?? fileName);

  const fileStats = await stat(filePath);
  const fileBytes = await readFile(filePath);

  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const prepared = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/artifacts/prepare-upload',
    {
      sessionKey,
      ticketId,
      fileName,
      label,
      artifactType: String(flags['artifact-type'] ?? 'document'),
      contentType,
      fileSize: fileStats.size,
      ...(flags['metadata-json'] ? { metadata: JSON.parse(String(flags['metadata-json'])) } : {})
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
    agentToken,
    localSecret,
    '/api/protocol/artifacts/finalize-upload',
    {
      sessionKey,
      ticketId,
      storagePath,
      label,
      artifactType: String(flags['artifact-type'] ?? 'document'),
      contentType,
      fileSize: fileStats.size,
      ...(flags['metadata-json'] ? { metadata: JSON.parse(String(flags['metadata-json'])) } : {})
    },
    timeoutMs
  );

  console.log(JSON.stringify(finalized, null, 2));
}

// ---------------------------------------------------------------------------
// connect (lightweight session, no context returned)
// ---------------------------------------------------------------------------

async function protocolConnect(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', 'TICKET_ID');
  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = {
    ticketId,
    agentIdentifier: String(flags.agent ?? process.env.AGENT_IDENTIFIER ?? 'claude-code'),
    connectionMethod: String(flags.method ?? 'cli'),
    metadata: {}
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/connect',
    body,
    timeoutMs
  );

  const sessionKey = data.session?.sessionKey;
  console.log(JSON.stringify(data, null, 2));

  if (sessionKey) {
    process.stderr.write(`\nSESSION_KEY=${sessionKey}\n`);
  }
}

// ---------------------------------------------------------------------------
// load-context (read-only ticket fetch, no session)
// ---------------------------------------------------------------------------

async function protocolLoadContext(args) {
  const flags = parseFlags(args);
  const ticketId = requireFlag(flags, 'ticket-id', 'TICKET_ID');
  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = { ticketId };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/load-context',
    body,
    timeoutMs
  );
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// spawn (create ticket + connect in one call)
// ---------------------------------------------------------------------------

async function protocolSpawn(args) {
  const flags = parseFlags(args);
  const objective = requireFlag(flags, 'objective', undefined);
  const { platformUrl, agentToken, localSecret } = resolveAuth();
  const timeoutMs = resolveTimeout(flags);

  const body = {
    objective,
    agentIdentifier: String(flags.agent ?? process.env.AGENT_IDENTIFIER ?? 'claude-code'),
    connectionMethod: String(flags.method ?? 'cli'),
    metadata: {},
    ...(flags.title ? { title: String(flags.title) } : {}),
    ...(flags.priority ? { priority: String(flags.priority) } : {}),
    ...(flags['project-id'] ? { projectId: String(flags['project-id']) } : {}),
    ...(flags['acceptance-criteria'] ? { acceptanceCriteria: String(flags['acceptance-criteria']) } : {}),
    ...(flags['available-tools'] ? { availableTools: String(flags['available-tools']) } : {}),
    ...(flags['execution-target'] ? { executionTarget: String(flags['execution-target']) } : {})
  };

  const data = await apiPost(
    platformUrl,
    agentToken,
    localSecret,
    '/api/protocol/spawn',
    body,
    timeoutMs
  );

  const sessionKey = data.session?.sessionKey;
  const ticketId = data.ticket?.id;
  console.log(JSON.stringify(data, null, 2));

  if (sessionKey) {
    process.stderr.write(`\nSESSION_KEY=${sessionKey}\n`);
  }
  if (ticketId) {
    process.stderr.write(`TICKET_ID=${ticketId}\n`);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function runProtocolCommand(subcommand, args) {
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    console.log(`ovld protocol <subcommand> [flags]

Subcommands:
  attach          Start a session on a ticket (returns full context)
  connect         Start a session on a ticket (lightweight, no context returned)
  load-context    Fetch ticket details read-only (no session created)
  spawn           Create a new ticket and connect to it immediately
  update          Post a progress update
  record-change-rationales  Persist structured change rationales
  ask             Post a blocking question
  read-context    Retrieve shared context
  write-context   Store a key/value in shared context
  deliver         Mark the ticket complete and deliver artifacts
  artifact-prepare-upload   Get a signed upload URL for a ticket artifact
  artifact-finalize-upload  Create artifact row after upload
  artifact-download-url     Get a signed download URL for an artifact
  artifact-upload-file      Upload local file and finalize in one command

Flags read from env vars when not provided:
  SESSION_KEY, TICKET_ID, OVERLORD_URL, AGENT_TOKEN

Common flags (all subcommands):
  --timeout <ms>          Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}).
                          Also: OVERLORD_TIMEOUT env var.

Change rationale flags (update & deliver):
  --change-rationales-json <json>  Inline JSON array of change rationale objects.
  --change-rationales-file <path>  Path to a JSON file containing change rationales.

Attach/update-specific flags:
  --external-session-id <id>  Store or clear ('null') the agent's native session id for resume.

Update-specific flags:
  --external-url <url>   Store or refresh a deep link to the current agent session.
  --change-rationales-json <json>  Inline JSON array of change rationale objects.
  --change-rationales-file <path>  Path to a JSON file containing change rationales.

Record-change-rationales flags:
  --summary <text>        Optional ticket-event summary for this rationale submission.
  --phase <status>        Optional phase for the rationale event (for example: execute).
  --change-rationales-json <json>  Inline JSON array of change rationale objects.
  --change-rationales-file <path>  Path to a JSON file containing change rationales.

Deliver-specific flags:
  --artifacts-json <json> Inline JSON array of artifact objects.
  --artifacts-file <path> Path to a JSON file containing artifacts (avoids shell-escaping issues
                          with large payloads).
  --change-rationales-json <json>  Inline JSON array of change rationale objects.
  --change-rationales-file <path>  Path to a JSON file containing change rationales.
  --skip-file-change-check Skip the local git/changeRationales reconciliation before deliver.

Spawn-specific flags:
  --objective <text>      Ticket objective (required)
  --title <text>          Ticket title (optional, derived from objective if omitted)
  --priority <level>      low | medium | high | urgent (default: medium)
  --project-id <id>       Target project (optional, defaults to first in org)
  --execution-target <t>  agent | human (default: agent)

Examples:
  ovld protocol attach --ticket-id abc-123
  ovld protocol connect --ticket-id abc-123
  ovld protocol load-context --ticket-id abc-123
  ovld protocol spawn --objective "Implement user auth" --priority high
  ovld protocol update --session-key <key> --ticket-id <id> --summary "Did X"
  ovld protocol record-change-rationales --session-key <key> --ticket-id <id> --change-rationales-json '[{"label":"...","file_path":"...","summary":"...","why":"...","impact":"...","hunks":[{"header":"@@ ... @@"}]}]'
  ovld protocol ask --session-key <key> --ticket-id <id> --question "Which approach?"
  ovld protocol read-context --session-key <key> --ticket-id <id>
  ovld protocol write-context --session-key <key> --ticket-id <id> --key "arch" --value '"monorepo"'
  ovld protocol artifact-upload-file --session-key <key> --ticket-id <id> --file ./spec.pdf --content-type application/pdf
  ovld protocol artifact-download-url --session-key <key> --ticket-id <id> --artifact-id <artifact-id>
  ovld protocol deliver --session-key <key> --ticket-id <id> --summary "Done"
  ovld protocol deliver --session-key <key> --ticket-id <id> --summary "Done" --artifacts-file ./artifacts.json
  ovld protocol deliver --session-key <key> --ticket-id <id> --summary "Done" --skip-file-change-check
  ovld protocol deliver --session-key <key> --ticket-id <id> --summary "Done" --timeout 60000
`);
    return;
  }

  if (subcommand === 'attach') { await protocolAttach(args); return; }
  if (subcommand === 'connect') { await protocolConnect(args); return; }
  if (subcommand === 'load-context') { await protocolLoadContext(args); return; }
  if (subcommand === 'spawn') { await protocolSpawn(args); return; }
  if (subcommand === 'artifact-prepare-upload') { await protocolArtifactPrepareUpload(args); return; }
  if (subcommand === 'artifact-finalize-upload') { await protocolArtifactFinalizeUpload(args); return; }
  if (subcommand === 'artifact-download-url') { await protocolArtifactGetDownloadUrl(args); return; }
  if (subcommand === 'artifact-upload-file') { await protocolArtifactUploadFile(args); return; }
  if (subcommand === 'update') { await protocolUpdate(args); return; }
  if (subcommand === 'record-change-rationales') { await protocolRecordChangeRationales(args); return; }
  if (subcommand === 'ask') { await protocolAsk(args); return; }
  if (subcommand === 'read-context') { await protocolReadContext(args); return; }
  if (subcommand === 'write-context') { await protocolWriteContext(args); return; }
  if (subcommand === 'deliver') { await protocolDeliver(args); return; }

  console.error(`Unknown protocol subcommand: ${subcommand}\n`);
  console.log('Run: ovld protocol help');
  process.exit(1);
}
