import { readPath } from '@overlord/core/service/agent-session/pure/codec';
import { hasControlCharacters } from '@overlord/core/service/agent-session/pure/evidence-path';
import path from 'node:path';

import { findAgentSessionCodec } from './agent-session/codec-registry.generated.js';
import { MAX_AGENT_SESSION_PAYLOAD_BYTES, normalizeForAdapter } from './agent-session/event.js';
import {
  resolveWorkingDirectoryForObjective,
  withActiveObjectiveSession
} from './active-objective-sessions.js';
import { appendChangeEvidence, recordChangeLedgerHealth } from './change-ledger.js';

const MAX_PATH_HINTS = 16;

function exactProjectDirectory(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value || value.length > 4_096 || hasControlCharacters(value)) return null;
  return value;
}

function resolveHookWorkingDirectory({
  payload,
  projectRootPaths,
  fallbackCwd
}: {
  payload: unknown;
  projectRootPaths: string[] | undefined;
  fallbackCwd: string;
}): string {
  for (const payloadPath of projectRootPaths ?? []) {
    const projectDirectory = exactProjectDirectory(readPath(payload, payloadPath));
    if (projectDirectory) return path.resolve(projectDirectory);
  }
  return path.resolve(fallbackCwd);
}

/** Seed a missing top-level project-root field so absolute edit paths can relativize. */
function withProjectRootFallback({
  payload,
  projectRootPaths,
  workingDirectory
}: {
  payload: unknown;
  projectRootPaths: string[] | undefined;
  workingDirectory: string;
}): unknown {
  const rootKey = projectRootPaths?.[0];
  if (!rootKey || rootKey.includes('.') || !payload || typeof payload !== 'object') {
    return payload;
  }
  if (Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  if (exactProjectDirectory(record[rootKey])) return payload;
  return { ...record, [rootKey]: workingDirectory };
}

/**
 * Collect absolute path strings from a native payload so a missing cwd can still
 * be tied back to the worktree that holds the objective binding. Only absolute
 * paths are kept; relative names never select among worktrees.
 */
function collectAbsolutePathHints(payload: unknown): string[] {
  const hints: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (hints.length >= MAX_PATH_HINTS || depth > 4) return;
    if (typeof value === 'string') {
      if (path.isAbsolute(value) && value.length <= 4_096 && !hasControlCharacters(value)) {
        hints.push(path.resolve(value));
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 8)) visit(entry, depth + 1);
      return;
    }
    for (const entry of Object.values(value as Record<string, unknown>).slice(0, 16)) {
      visit(entry, depth + 1);
    }
  };
  visit(payload, 0);
  return hints;
}

export type CaptureChangeResult =
  | { recorded: true; objectiveId: string; files: number }
  | { recorded: false; reason: string };

/**
 * Append direct native edit paths to the explicitly addressed objective ledger.
 * Shell/no-path callbacks record health only; this function never scans a
 * worktree and never reads transcripts or file content.
 */
export function captureChangeFromPayload({
  agent,
  rawPayload,
  objectiveOverride,
  fallbackCwd
}: {
  agent: string;
  rawPayload: string | null;
  objectiveOverride?: string;
  fallbackCwd: string;
}): CaptureChangeResult {
  const objectiveId = objectiveOverride?.trim();
  if (!objectiveId) {
    return { recorded: false, reason: 'explicit objective id is required' };
  }

  const adapter = agent.trim();
  if (!adapter) {
    return { recorded: false, reason: 'explicit agent is required' };
  }
  const codec = findAgentSessionCodec(adapter);
  if (!codec) {
    return { recorded: false, reason: 'agent has no capture codec' };
  }

  let nativePayload: unknown = {};
  let payloadFailure: 'invalid JSON payload' | 'native payload unavailable' | null = null;
  if (
    rawPayload === null ||
    Buffer.byteLength(rawPayload, 'utf8') > MAX_AGENT_SESSION_PAYLOAD_BYTES
  ) {
    payloadFailure = 'native payload unavailable';
  } else {
    try {
      nativePayload = JSON.parse(rawPayload) as unknown;
    } catch {
      payloadFailure = 'invalid JSON payload';
    }
  }

  const candidateWorkingDirectory = resolveHookWorkingDirectory({
    payload: nativePayload,
    projectRootPaths: codec.projectRootPaths,
    fallbackCwd
  });
  const workingDirectory =
    resolveWorkingDirectoryForObjective({
      objectiveId,
      candidateWorkingDirectory,
      pathHints: collectAbsolutePathHints(nativePayload)
    }) ?? candidateWorkingDirectory;
  // Cursor postToolUse often omits cwd while still naming absolute edit paths.
  // After the objective binding recovers the worktree, seed the codec's project
  // root so absolute evidence paths relativize instead of being dropped.
  const payloadForNormalize = withProjectRootFallback({
    payload: nativePayload,
    projectRootPaths: codec.projectRootPaths,
    workingDirectory
  });
  const normalized = payloadFailure
    ? null
    : normalizeForAdapter({ codec, payload: payloadForNormalize });
  const directPaths =
    normalized?.kind === 'file.edited' && Array.isArray(normalized.payload.paths)
      ? normalized.payload.paths.filter((value): value is string => typeof value === 'string')
      : [];
  const confidentlyNonMutating =
    normalized?.kind === 'tool.completed' &&
    (normalized.payload.tool === 'read' ||
      normalized.payload.tool === 'search' ||
      normalized.payload.tool === 'fetch');
  return withActiveObjectiveSession<CaptureChangeResult>({
    workingDirectory,
    objectiveId,
    fallback: { recorded: false, reason: 'no matching objective session binding' },
    action: session => {
      if (payloadFailure) {
        recordChangeLedgerHealth({
          workingDirectory,
          objectiveId: session.objectiveId,
          sessionKey: session.sessionKey,
          code: 'native_payload_unavailable'
        });
        return { recorded: false, reason: payloadFailure };
      }
      if (confidentlyNonMutating) {
        return { recorded: false, reason: 'native event is confidently non-mutating' };
      }
      if (directPaths.length === 0) {
        recordChangeLedgerHealth({
          workingDirectory,
          objectiveId: session.objectiveId,
          sessionKey: session.sessionKey,
          code: 'direct_path_unavailable'
        });
        return {
          recorded: false,
          reason:
            normalized?.kind === 'file.edited'
              ? 'native edit contains no exact path evidence'
              : 'native event is not a declared file edit'
        };
      }

      const files = appendChangeEvidence({
        workingDirectory,
        objectiveId: session.objectiveId,
        sessionKey: session.sessionKey,
        filePaths: directPaths,
        source: 'declared_edit',
        quality: 'direct',
        overlap: false,
        hookHealth: 'direct_path_observed'
      });
      if (files === 0) {
        return { recorded: false, reason: 'no new exact path evidence was appended' };
      }

      return { recorded: true, objectiveId: session.objectiveId, files };
    }
  });
}
