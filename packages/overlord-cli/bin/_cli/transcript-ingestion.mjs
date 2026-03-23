import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PARSER_VERSION = 'transcript-v1';
const MAX_COMMAND_PREVIEW = 240;
const MAX_SUMMARY = 600;
const MAX_EVIDENCE = 6;
const MAX_EVENTS = 200;
const MAX_DRAFTS = 50;

function sha1(value) {
  return createHash('sha1').update(value).digest('hex');
}

function truncate(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function toPosixPath(value) {
  return value.replaceAll(path.sep, '/').replaceAll('\\', '/');
}

export function normalizeRepoRelativeFilePath(filePath, repoRoot) {
  if (typeof filePath !== 'string') return null;
  const trimmed = filePath.trim();
  if (!trimmed) return null;

  if (repoRoot && path.isAbsolute(trimmed)) {
    const relative = path.relative(repoRoot, trimmed);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    return toPosixPath(relative);
  }

  return trimmed.replace(/^[.][/\\]+/, '').replaceAll('\\', '/');
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      if (item.type === 'text' && typeof item.text === 'string') return [item.text];
      if (typeof item.content === 'string') return [item.content];
      return [];
    })
    .join('\n')
    .trim();
}

function summarizeToolInput(toolName, input) {
  if (!input || typeof input !== 'object') return toolName;

  const command =
    typeof input.command === 'string'
      ? input.command
      : typeof input.cmd === 'string'
        ? input.cmd
        : '';
  const description = typeof input.description === 'string' ? input.description : '';
  const filePath =
    typeof input.file_path === 'string'
      ? input.file_path
      : typeof input.path === 'string'
        ? input.path
        : '';
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';

  const pieces = [description, command, filePath, pattern].filter(Boolean);
  return truncate(pieces[0] || toolName, MAX_SUMMARY);
}

function buildCommandPreview(input) {
  if (!input || typeof input !== 'object') return null;
  const command =
    typeof input.command === 'string'
      ? input.command
      : typeof input.cmd === 'string'
        ? input.cmd
        : null;
  return command ? truncate(command, MAX_COMMAND_PREVIEW) : null;
}

function findRepoRoot(cwd) {
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    return repoRoot || null;
  } catch {
    return null;
  }
}

function getGitHunkHeaders(repoRoot, filePath) {
  if (!repoRoot || !filePath) return [];

  try {
    const output = execFileSync('git', ['diff', '--unified=0', '--', filePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    return output
      .split('\n')
      .filter(line => line.startsWith('@@ '))
      .map(header => ({ header: header.trim() }))
      .slice(0, 20);
  } catch {
    return [];
  }
}

function getGitChangedFilesWithHunks(cwd) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    return {
      changedFiles: new Set(),
      hunkHeadersByFile: new Map(),
      repoRoot: null
    };
  }

  const output = execFileSync('git', ['status', '--porcelain=v1', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const changedFiles = new Set();
  const hunkHeadersByFile = new Map();
  const entries = output.split('\0');

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;

    const status = entry.slice(0, 2);
    const normalizedPath = normalizeRepoRelativeFilePath(entry.slice(3), repoRoot);
    if (normalizedPath) {
      changedFiles.add(normalizedPath);
      hunkHeadersByFile.set(normalizedPath, getGitHunkHeaders(repoRoot, normalizedPath));
    }

    if (status.includes('R') || status.includes('C')) {
      i += 1;
    }
  }

  return {
    changedFiles,
    hunkHeadersByFile,
    repoRoot
  };
}

function stateDir() {
  return path.join(os.homedir(), '.ovld', 'transcript-ingestion');
}

function stateFilePath(agentIdentifier, externalSessionId, cwd) {
  const digest = sha1([agentIdentifier, externalSessionId, cwd].join('\0'));
  return path.join(stateDir(), `${digest}.json`);
}

function readState(agentIdentifier, externalSessionId, cwd) {
  if (!externalSessionId) return null;
  const filePath = stateFilePath(agentIdentifier, externalSessionId, cwd);
  try {
    return {
      filePath,
      state: JSON.parse(fs.readFileSync(filePath, 'utf8'))
    };
  } catch {
    return {
      filePath,
      state: null
    };
  }
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function readDelta(sourcePath, lastOffset) {
  const stats = fs.statSync(sourcePath);
  const nextOffset = Math.min(Math.max(lastOffset ?? 0, 0), stats.size);
  if (stats.size === nextOffset) {
    return { chunk: '', nextOffset: stats.size };
  }

  const fd = fs.openSync(sourcePath, 'r');
  try {
    const length = stats.size - nextOffset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, nextOffset);
    return {
      chunk: buffer.toString('utf8'),
      nextOffset: stats.size
    };
  } finally {
    fs.closeSync(fd);
  }
}

function claudeProjectDir(cwd) {
  return cwd.replace(/\//g, '-');
}

function locateClaudeTranscript(externalSessionId, cwd) {
  if (!cwd) return null;
  const projectDir = path.join(os.homedir(), '.claude', 'projects', claudeProjectDir(cwd));
  if (!fs.existsSync(projectDir)) return null;

  if (externalSessionId) {
    const exact = path.join(projectDir, `${externalSessionId}.jsonl`);
    if (fs.existsSync(exact)) return exact;
  }

  const candidates = fs.readdirSync(projectDir)
    .filter(file => file.endsWith('.jsonl'))
    .map(file => ({
      file,
      mtimeMs: fs.statSync(path.join(projectDir, file)).mtimeMs
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0] ? path.join(projectDir, candidates[0].file) : null;
}

function locateCodexTranscript(externalSessionId) {
  const historyPath = path.join(os.homedir(), '.codex', 'history.jsonl');
  if (fs.existsSync(historyPath) && externalSessionId) {
    return historyPath;
  }

  const archivedDir = path.join(os.homedir(), '.codex', 'archived_sessions');
  if (!fs.existsSync(archivedDir) || !externalSessionId) return null;

  const match = fs.readdirSync(archivedDir).find(file => file.includes(externalSessionId));
  return match ? path.join(archivedDir, match) : null;
}

function eventBase({
  eventHash,
  eventTime,
  eventKind,
  summary,
  actor = null,
  toolName = null,
  filePath = null,
  commandPreview = null,
  highSignal = false,
  evidence = {},
  rawPayload = {}
}) {
  return {
    actor,
    commandPreview,
    eventHash,
    eventKind,
    eventTime,
    evidence,
    filePath,
    highSignal,
    rawPayload,
    summary: truncate(summary || '', MAX_SUMMARY) || null,
    toolName
  };
}

export function parseClaudeTranscriptLines({
  lines,
  previousFileVersions = {},
  repoRoot = null
}) {
  const events = [];
  const fileVersions = { ...previousFileVersions };

  for (const line of lines) {
    const entry = tryParseJson(line);
    if (!entry || typeof entry !== 'object') continue;

    if (entry.type === 'file-history-snapshot' && entry.snapshot?.trackedFileBackups) {
      const tracked = entry.snapshot.trackedFileBackups;
      for (const [filePath, backup] of Object.entries(tracked)) {
        const version = Number(backup?.version ?? 0);
        const previousVersion = Number(fileVersions[filePath] ?? 0);
        fileVersions[filePath] = version;

        if (!filePath || version <= previousVersion) continue;

        const normalizedFilePath = normalizeRepoRelativeFilePath(filePath, repoRoot);
        if (!normalizedFilePath) continue;

        events.push(
          eventBase({
            eventHash: sha1(`${line}\0${normalizedFilePath}\0${version}`),
            eventKind: 'file_edit',
            eventTime: backup?.backupTime ?? entry.snapshot?.timestamp ?? new Date().toISOString(),
            filePath: normalizedFilePath,
            highSignal: true,
            summary: `Edited ${normalizedFilePath}`,
            toolName: 'file-history-snapshot',
            evidence: { version },
            rawPayload: { filePath: normalizedFilePath, version }
          })
        );
      }

      continue;
    }

    const message = entry.message;
    const content = Array.isArray(message?.content) ? message.content : [];

    for (const item of content) {
      if (!item || typeof item !== 'object') continue;

      if (item.type === 'tool_use') {
        const normalizedFilePath = normalizeRepoRelativeFilePath(
          item.input?.file_path ?? item.input?.path ?? null,
          repoRoot
        );
        events.push(
          eventBase({
            actor: 'assistant',
            commandPreview: buildCommandPreview(item.input),
            eventHash: sha1(`${line}\0${item.id ?? item.name ?? 'tool_use'}`),
            eventKind: 'tool_use',
            eventTime: entry.timestamp ?? new Date().toISOString(),
            filePath: normalizedFilePath,
            highSignal: Boolean(normalizedFilePath),
            summary: summarizeToolInput(item.name ?? 'tool', item.input),
            toolName: item.name ?? null,
            evidence: item.input ?? {},
            rawPayload: item
          })
        );
      }
    }

    if (message?.role === 'assistant') {
      const text = extractTextContent(message.content);
      if (text) {
        events.push(
          eventBase({
            actor: 'assistant',
            eventHash: sha1(`${line}\0assistant_text`),
            eventKind: 'commentary',
            eventTime: entry.timestamp ?? new Date().toISOString(),
            summary: text,
            rawPayload: { text }
          })
        );
      }
    }
  }

  return { events, fileVersions };
}

function extractCodexPatchFiles(patchText) {
  if (typeof patchText !== 'string') return [];
  return patchText
    .split('\n')
    .flatMap(line => {
      const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
      return match ? [match[1].trim()] : [];
    });
}

export function parseCodexTranscriptLines({
  lines,
  externalSessionId,
  repoRoot = null,
  sessionActive = false
}) {
  const events = [];
  let active = sessionActive;

  for (const line of lines) {
    const entry = tryParseJson(line);
    if (!entry || typeof entry !== 'object') continue;

    if (entry.type === 'session_meta') {
      active = entry.payload?.id === externalSessionId;
      continue;
    }

    if (!active && externalSessionId) {
      continue;
    }

    if (entry.type === 'event_msg' && entry.payload?.type === 'agent_message') {
      const text = typeof entry.payload?.message === 'string' ? entry.payload.message : '';
      if (text) {
        events.push(
          eventBase({
            actor: 'assistant',
            eventHash: sha1(`${line}\0agent_message`),
            eventKind: 'commentary',
            eventTime: entry.timestamp ?? new Date().toISOString(),
            summary: text,
            rawPayload: entry.payload
          })
        );
      }
      continue;
    }

    if (entry.type === 'event_msg' && entry.payload?.type === 'agent_reasoning') {
      const text = typeof entry.payload?.text === 'string' ? entry.payload.text : '';
      if (text) {
        events.push(
          eventBase({
            actor: 'assistant',
            eventHash: sha1(`${line}\0agent_reasoning`),
            eventKind: 'commentary',
            eventTime: entry.timestamp ?? new Date().toISOString(),
            summary: text.replace(/\*\*/g, ''),
            rawPayload: entry.payload
          })
        );
      }
      continue;
    }

    if (entry.type !== 'response_item' || entry.payload?.type !== 'function_call') {
      continue;
    }

    const toolName = entry.payload?.name ?? null;
    const input = tryParseJson(entry.payload?.arguments ?? '{}') ?? {};
    const normalizedFilePath = normalizeRepoRelativeFilePath(
      input.file_path ?? input.path ?? null,
      repoRoot
    );
    const baseEvent = eventBase({
      actor: 'assistant',
      commandPreview: buildCommandPreview(input),
      eventHash: sha1(`${line}\0${entry.payload?.call_id ?? toolName ?? 'function_call'}`),
      eventKind: 'tool_use',
      eventTime: entry.timestamp ?? new Date().toISOString(),
      filePath: normalizedFilePath,
      highSignal: Boolean(normalizedFilePath),
      summary: summarizeToolInput(toolName ?? 'tool', input),
      toolName,
      evidence: input,
      rawPayload: entry.payload
    });

    events.push(baseEvent);

    if (toolName === 'apply_patch') {
      const patchFiles = extractCodexPatchFiles(entry.payload?.arguments ?? '');
      for (const filePath of patchFiles) {
        const normalized = normalizeRepoRelativeFilePath(filePath, repoRoot);
        if (!normalized) continue;
        events.push(
          eventBase({
            actor: 'assistant',
            eventHash: sha1(`${line}\0apply_patch\0${normalized}`),
            eventKind: 'file_edit',
            eventTime: entry.timestamp ?? new Date().toISOString(),
            filePath: normalized,
            highSignal: true,
            summary: `Edited ${normalized}`,
            toolName: 'apply_patch',
            evidence: { filePath: normalized },
            rawPayload: entry.payload
          })
        );
      }
    }
  }

  return { events, sessionActive: active };
}

function nearestContextSummary(events, index) {
  for (let i = index; i >= 0 && i >= index - 8; i--) {
    const candidate = events[i];
    if (candidate?.eventKind === 'commentary' && candidate.summary) {
      return candidate.summary;
    }
  }
  return null;
}

function cleanSummary(value, filePath) {
  const normalized = truncate((value || '').replace(/\s+/g, ' '), 220);
  if (normalized) return normalized;
  return `Transcript evidence suggests meaningful edits in ${filePath}.`;
}

function draftLabel(summary, filePath) {
  const firstSentence = summary.split(/[.!?]/)[0]?.trim();
  if (firstSentence) return truncate(firstSentence, 90);
  return `Review ${path.basename(filePath)}`;
}

export function generateRationaleDrafts({
  events,
  changedFiles,
  explicitRationalePaths = [],
  hunkHeadersByFile = new Map()
}) {
  const explicitPaths = new Set(explicitRationalePaths.filter(Boolean));
  const drafts = [];

  for (const filePath of changedFiles) {
    if (explicitPaths.has(filePath)) continue;

    const relatedEvents = events
      .map((event, index) => ({
        ...event,
        _index: index,
        _score:
          event.filePath === filePath
            ? event.eventKind === 'file_edit'
              ? 120
              : event.eventKind === 'tool_use'
                ? 70
                : 25
            : 0
      }))
      .filter(event => event._score > 0)
      .sort((left, right) => {
        if (right._score !== left._score) return right._score - left._score;
        return new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime();
      });

    if (relatedEvents.length === 0) continue;

    const strongest = relatedEvents[0];
    const contextSummary = nearestContextSummary(events, strongest._index);
    const summary = cleanSummary(contextSummary || strongest.summary, filePath);
    const confidence =
      strongest._score >= 120 ? 'high' : strongest._score >= 70 ? 'medium' : 'low';

    drafts.push({
      attribution_source: 'transcript_draft',
      change_kind: strongest.eventKind === 'file_edit' ? 'modify' : 'review',
      confidence,
      evidence: relatedEvents.slice(0, MAX_EVIDENCE).map(event => ({
        event_hash: event.eventHash,
        event_kind: event.eventKind,
        score: event._score,
        summary: event.summary,
        tool_name: event.toolName,
        when: event.eventTime
      })),
      file_path: filePath,
      hunks: hunkHeadersByFile.get(filePath) ?? [],
      impact: `Likely affects ${path.basename(filePath)}. Confirm the exact behavioral impact against the current diff before delivery.`,
      label: draftLabel(summary, filePath),
      source_event_hashes: relatedEvents.slice(0, MAX_EVIDENCE).map(event => event.eventHash),
      status: 'draft',
      summary,
      why: contextSummary
        ? `Derived from nearby agent commentary and transcript evidence: ${truncate(contextSummary, 220)}`
        : `Derived from ${strongest.toolName || strongest.eventKind} activity recorded in the local agent transcript.`
    });
  }

  return drafts.slice(0, MAX_DRAFTS);
}

function buildStatePayload(existingState, nextState) {
  return {
    ...(existingState ?? {}),
    ...nextState,
    updatedAt: new Date().toISOString()
  };
}

export function prepareTranscriptIngestion({
  agentIdentifier,
  apiPost,
  changeRationales = [],
  externalSessionId,
  platformUrl,
  sessionKey,
  ticketId,
  token,
  localSecret
}) {
  if (!externalSessionId || !agentIdentifier) return null;

  const cwd = process.cwd();
  const repoRoot = findRepoRoot(cwd);
  const gitState = getGitChangedFilesWithHunks(cwd);
  const { filePath: cachedStatePath, state: existingState } = readState(
    agentIdentifier,
    externalSessionId,
    cwd
  );

  const isCodex = agentIdentifier.toLowerCase().includes('codex');
  const sourcePath = isCodex
    ? locateCodexTranscript(externalSessionId)
    : locateClaudeTranscript(externalSessionId, cwd);

  if (!sourcePath || !fs.existsSync(sourcePath)) return null;

  const previousOffset =
    existingState?.sourcePath === sourcePath ? Number(existingState?.offset ?? 0) : 0;
  const { chunk, nextOffset } = readDelta(sourcePath, previousOffset);
  if (!chunk) {
    return null;
  }

  const lines = chunk.split('\n').filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const parsed = isCodex
    ? parseCodexTranscriptLines({
        lines,
        externalSessionId,
        repoRoot,
        sessionActive: Boolean(existingState?.codexSessionActive)
      })
    : parseClaudeTranscriptLines({
        lines,
        previousFileVersions: existingState?.claudeFileVersions ?? {},
        repoRoot
      });

  const events = parsed.events.slice(0, MAX_EVENTS);
  const drafts = generateRationaleDrafts({
    events,
    changedFiles: [...gitState.changedFiles],
    explicitRationalePaths: changeRationales.map(rationale => rationale?.file_path).filter(Boolean),
    hunkHeadersByFile: gitState.hunkHeadersByFile
  });

  if (events.length === 0 && drafts.length === 0) {
    return null;
  }

  const statePayload = buildStatePayload(existingState, {
    codexSessionActive: parsed.sessionActive ?? existingState?.codexSessionActive ?? false,
    claudeFileVersions: parsed.fileVersions ?? existingState?.claudeFileVersions ?? {},
    cwd,
    offset: nextOffset,
    repoRoot,
    sourcePath
  });

  const body = {
    drafts,
    events,
    externalSessionId,
    parserVersion: PARSER_VERSION,
    sessionKey,
    sourceAgent: agentIdentifier,
    sourcePath,
    ticketId
  };

  return {
    async ingest() {
      await apiPost(
        platformUrl,
        token,
        localSecret,
        '/api/protocol/transcript-ingest',
        body
      );
      writeState(cachedStatePath, statePayload);
    }
  };
}
