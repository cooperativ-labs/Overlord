import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Codex folder trust for Overlord-launched app-server threads (plan §3.8, §7.6).
 *
 * `thread/start` with a `cwd` in an untrusted git checkout and a writable sandbox writes
 *
 *     [projects."<cwd>"]
 *     trust_level = "trusted"
 *
 * into the user's Codex config (LIVE on 0.170). That implicit trust is what lets a fresh
 * worktree load its project config, the Overlord MCP server and plugin hooks, so Overlord accepts
 * it as the equivalent of `codex exec --trust` (which applies to exec, not to app-server
 * threads). It must not accumulate: every Overlord worktree would otherwise stay trusted in the
 * user's config forever.
 *
 * So the supervisor records whether an entry for the directory existed before `thread/start`,
 * and, if the start added one, removes exactly that entry when the session ends — and only when
 * the table still holds nothing but `trust_level = "trusted"`. An entry the user wrote, an
 * explicit `untrusted`, or a table someone has since added keys to is never touched.
 *
 * The edit is a line-level rewrite of one table, written to a temp file and renamed, after
 * checking the file has not changed since it was read. It is done after the private server has
 * stopped, so that server cannot race it; a user's own Codex session writing the same file in the
 * same instant could, and the mtime check makes that a skipped cleanup rather than a lost write.
 */

export function codexConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.CODEX_HOME?.trim() || path.join(env.HOME?.trim() || os.homedir(), '.codex');
  return path.join(home, 'config.toml');
}

/** The TOML basic-string form Codex writes for a project key. */
export function projectTableHeader(projectPath: string): string {
  const escaped = projectPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[projects."${escaped}"]`;
}

type TableSpan = { start: number; end: number; body: string[] };

function findProjectTable(lines: string[], projectPath: string): TableSpan | null {
  const header = projectTableHeader(projectPath);
  const start = lines.findIndex(line => line.trim() === header);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end += 1;
  return { start, end, body: lines.slice(start + 1, end) };
}

function readConfig(configPath: string): string | null {
  try {
    return existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
  } catch {
    return null;
  }
}

/** True when the Codex config has any table for this project path. */
export function hasProjectTrustEntry(
  projectPath: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const text = readConfig(codexConfigPath(env));
  return text !== null && findProjectTable(text.split('\n'), projectPath) !== null;
}

/** The trust level the config records for this exact path, if any. */
export function projectTrustLevel(
  projectPath: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const text = readConfig(codexConfigPath(env));
  if (text === null) return null;
  const table = findProjectTable(text.split('\n'), projectPath);
  if (!table) return null;
  for (const line of table.body) {
    const match = /^\s*trust_level\s*=\s*"([^"]*)"\s*(#.*)?$/.exec(line);
    if (match) return match[1] ?? null;
  }
  return null;
}

/**
 * The candidate paths `thread/start` may have recorded for a working directory: the path as given
 * and its resolved form (macOS `/var` → `/private/var`, symlinked checkouts).
 */
export function trustCandidates(cwd: string): string[] {
  const out = [cwd];
  try {
    const real = realpathSync(cwd);
    if (real !== cwd) out.push(real);
  } catch {
    // Keep the given path.
  }
  return out;
}

export type TrustRemoval = 'removed' | 'absent' | 'modified' | 'changed-concurrently' | 'error';

/**
 * Remove the `[projects."<path>"]` table when it holds only `trust_level = "trusted"`.
 * Blank lines and comments inside the table do not count as content.
 */
export function removeImplicitTrustEntry(
  projectPath: string,
  env: NodeJS.ProcessEnv = process.env
): TrustRemoval {
  const linkPath = codexConfigPath(env);
  try {
    if (!existsSync(linkPath)) return 'absent';
    // Edit the file a symlinked config (a dotfile manager's) points at, so the link survives.
    const configPath = realpathSync(linkPath);
    const before = statSync(configPath);
    const text = readFileSync(configPath, 'utf8');
    const lines = text.split('\n');
    const table = findProjectTable(lines, projectPath);
    if (!table) return 'absent';
    const content = table.body.filter(line => line.trim() && !line.trim().startsWith('#'));
    if (content.length !== 1 || !/^\s*trust_level\s*=\s*"trusted"\s*$/.test(content[0]!)) {
      return 'modified';
    }
    // Drop the table and the blank line that separated it from the previous one.
    let start = table.start;
    if (start > 0 && lines[start - 1]!.trim() === '') start -= 1;
    const next = [...lines.slice(0, start), ...lines.slice(table.end)];
    const temp = `${configPath}.ovld-${process.pid}.tmp`;
    writeFileSync(temp, next.join('\n'), { mode: before.mode & 0o777 });
    // Checked as late as possible: the window in which a concurrent writer's change could be
    // replaced is the stat-to-rename gap only. Codex itself writes this file through
    // `config/batchWrite`, which the session's own server is no longer running to do.
    const after = statSync(configPath);
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      rmSync(temp, { force: true });
      return 'changed-concurrently';
    }
    renameSync(temp, configPath);
    return 'removed';
  } catch {
    return 'error';
  }
}

/**
 * Recorded before `thread/start`: which candidate paths already had a table. After the thread
 * starts, {@link addedTrustEntry} returns the path whose table appeared, which is the only entry
 * Overlord may later remove.
 */
export function snapshotTrustEntries(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): Map<string, boolean> {
  return new Map(
    trustCandidates(cwd).map(candidate => [candidate, hasProjectTrustEntry(candidate, env)])
  );
}

export function addedTrustEntry(
  before: Map<string, boolean>,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  for (const [candidate, existed] of before) {
    if (!existed && projectTrustLevel(candidate, env) === 'trusted') return candidate;
  }
  return null;
}
