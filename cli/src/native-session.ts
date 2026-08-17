import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { resolveGlobalDataDir } from './config.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function sessionCachePath({
  agent,
  missionId,
  workingDirectory,
  objectiveId
}: {
  agent: string;
  missionId: string;
  workingDirectory: string;
  objectiveId?: string | null;
}): string {
  const resolved = path.resolve(workingDirectory);
  const material = objectiveId?.trim()
    ? `${resolved}\0${missionId}\0${agent}\0${objectiveId.trim()}`
    : `${resolved}\0${missionId}\0${agent}`;
  const key = createHash('sha256').update(material).digest('hex');
  return path.join(resolveGlobalDataDir(), 'native-sessions', key);
}

function readCachedNativeSessionId({
  agent,
  missionId,
  workingDirectory,
  objectiveId
}: {
  agent: string;
  missionId: string;
  workingDirectory: string;
  objectiveId?: string | null;
}): string | undefined {
  try {
    const paths = objectiveId?.trim()
      ? [
          sessionCachePath({ agent, missionId, workingDirectory, objectiveId }),
          sessionCachePath({ agent, missionId, workingDirectory })
        ]
      : [sessionCachePath({ agent, missionId, workingDirectory })];
    for (const filePath of paths) {
      if (!existsSync(filePath)) continue;
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { externalSessionId?: unknown };
      if (typeof raw.externalSessionId === 'string' && raw.externalSessionId.trim()) {
        return raw.externalSessionId.trim();
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Record a harness's native session id for later correlation.
 *
 * This cache is a **lookup alias and nothing more**. Writing an entry grants no scope, and
 * reading one authorizes no event: the entry's whole job is to let a later process ask "which
 * harness conversation was this?" without re-deriving it. Authorization comes from the channel
 * credential, which lives somewhere else entirely (`agent-session/channel.ts`) for exactly this
 * reason — so that no future reader can mistake this file for a grant.
 *
 * The connectors' prompt hooks write this same shape inline today. Centralizing the writer here
 * means the key derivation exists once rather than once per adapter shell script.
 */
export function writeNativeSessionId({
  agent,
  missionId,
  externalSessionId,
  workingDirectory = process.cwd(),
  objectiveId
}: {
  agent: string;
  missionId: string;
  externalSessionId: string;
  workingDirectory?: string;
  objectiveId?: string | null;
}): void {
  const payload = JSON.stringify({
    agent: agent.toLowerCase(),
    missionId,
    ...(objectiveId?.trim() ? { objectiveId: objectiveId.trim() } : {}),
    externalSessionId
  });
  const write = (filePath: string) => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, payload, 'utf8');
  };
  write(
    sessionCachePath({
      agent: agent.toLowerCase(),
      missionId,
      workingDirectory
    })
  );
  if (objectiveId?.trim()) {
    write(
      sessionCachePath({
        agent: agent.toLowerCase(),
        missionId,
        workingDirectory,
        objectiveId
      })
    );
  }
}

function detectCodexSessionIdFromDisk(workingDirectory: string): string | undefined {
  const sessionsDir = path.join(homedir(), '.codex', 'sessions');
  if (!existsSync(sessionsDir)) return undefined;

  const candidates: Array<{ mtime: number; filePath: string }> = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) {
        continue;
      }
      try {
        candidates.push({ mtime: statSync(filePath).mtimeMs, filePath });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  };

  try {
    visit(sessionsDir);
  } catch {
    return undefined;
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  let fallback: string | undefined;

  for (const candidate of candidates.slice(0, 25)) {
    let nativeId: string | undefined;
    let cwd: string | undefined;
    try {
      const [firstLine = ''] = readFileSync(candidate.filePath, 'utf8').split(/\r?\n/, 1);
      const obj = JSON.parse(firstLine) as Record<string, unknown>;
      const payload =
        obj.payload && typeof obj.payload === 'object'
          ? (obj.payload as Record<string, unknown>)
          : obj;
      if (typeof payload.id === 'string') nativeId = payload.id.match(UUID_RE)?.[0];
      if (typeof payload.cwd === 'string') cwd = payload.cwd;
    } catch {
      nativeId = undefined;
    }
    nativeId ??= path.basename(candidate.filePath).match(UUID_RE)?.[0];
    if (!nativeId) continue;
    fallback ??= nativeId;
    if (cwd && path.resolve(cwd) === path.resolve(workingDirectory)) return nativeId;
  }

  return fallback;
}

export function resolveNativeSessionId({
  explicit,
  agent,
  missionId,
  workingDirectory = process.cwd(),
  env = process.env,
  objectiveId
}: {
  explicit?: string;
  agent: string;
  missionId: string;
  workingDirectory?: string;
  env?: NodeJS.ProcessEnv;
  objectiveId?: string | null;
}): string | null | undefined {
  if (explicit !== undefined) {
    const trimmed = explicit.trim();
    return trimmed === 'null' ? null : trimmed || undefined;
  }

  const normalizedAgent = agent.toLowerCase();
  const cached = readCachedNativeSessionId({
    agent: normalizedAgent,
    missionId,
    workingDirectory,
    objectiveId: objectiveId ?? env.OVERLORD_OBJECTIVE_ID
  });
  if (normalizedAgent === 'codex') {
    return (
      env.CODEX_THREAD_ID?.trim() ||
      env.CODEX_SESSION_ID?.trim() ||
      cached ||
      detectCodexSessionIdFromDisk(workingDirectory)
    );
  }

  return cached;
}
