import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { projectTmpDir } from './project-tmp.js';

/**
 * Recover launch bootstrap values that wrappers (notably agent-pod / `agp`) may strip
 * from the agent process environment even though the host launch script exported them.
 *
 * The channel *id* is not secret — only the credential is — and the launch script already
 * contains the id in plain text under `.overlord/tmp`. Reading it back is how attach can
 * still bind the prepared channel when `OVERLORD_SESSION_CHANNEL_ID` never reached the
 * agent process.
 */

export type RecoveredLaunchBootstrap = {
  sessionChannelId: string | null;
  executionRequestId: string | null;
  objectiveId: string | null;
  sourcePath: string | null;
};

const EXPORT_CHANNEL_ID_RE =
  /(?:^|[;\s])export\s+OVERLORD_SESSION_CHANNEL_ID=(?:'([^']+)'|"([^"]+)"|([^\s;]+))/m;
const EXPORT_EXECUTION_REQUEST_ID_RE =
  /(?:^|[;\s])export\s+OVERLORD_EXECUTION_REQUEST_ID=(?:'([^']+)'|"([^"]+)"|([^\s;]+))/m;
const EXPORT_OBJECTIVE_ID_RE =
  /(?:^|[;\s])export\s+OVERLORD_OBJECTIVE_ID=(?:'([^']+)'|"([^"]+)"|([^\s;]+))/m;

function firstCapture(match: RegExpMatchArray | null): string | null {
  if (!match) return null;
  const value = match[1] ?? match[2] ?? match[3] ?? null;
  return value && value.trim() ? value.trim() : null;
}

function safeMissionPart(missionId: string): string {
  return missionId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'launch';
}

/**
 * Find the newest launch script for this mission under `<checkout>/.overlord/tmp` and
 * parse the bootstrap exports Overlord wrote into it.
 */
export function recoverLaunchBootstrapFromProjectTmp({
  workingDirectory,
  missionId
}: {
  workingDirectory: string;
  missionId: string;
}): RecoveredLaunchBootstrap {
  const empty: RecoveredLaunchBootstrap = {
    sessionChannelId: null,
    executionRequestId: null,
    objectiveId: null,
    sourcePath: null
  };
  const trimmedMission = missionId.trim();
  if (!trimmedMission) return empty;

  const tmpDir = projectTmpDir(workingDirectory);
  if (!existsSync(tmpDir)) return empty;

  const prefix = `launch-${safeMissionPart(trimmedMission)}-`;
  let newest: { path: string; mtimeMs: number } | null = null;
  try {
    for (const name of readdirSync(tmpDir)) {
      if (!name.startsWith(prefix) || !name.endsWith('.sh')) continue;
      const filePath = path.join(tmpDir, name);
      try {
        const mtimeMs = statSync(filePath).mtimeMs;
        if (!newest || mtimeMs > newest.mtimeMs) {
          newest = { path: filePath, mtimeMs };
        }
      } catch {
        // Skip entries that disappear between readdir and stat.
      }
    }
  } catch {
    return empty;
  }

  if (!newest) return empty;

  let contents = '';
  try {
    contents = readFileSync(newest.path, 'utf8');
  } catch {
    return empty;
  }

  return {
    sessionChannelId: firstCapture(contents.match(EXPORT_CHANNEL_ID_RE)),
    executionRequestId: firstCapture(contents.match(EXPORT_EXECUTION_REQUEST_ID_RE)),
    objectiveId: firstCapture(contents.match(EXPORT_OBJECTIVE_ID_RE)),
    sourcePath: newest.path
  };
}
