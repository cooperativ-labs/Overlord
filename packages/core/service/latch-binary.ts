/**
 * One resolution path for every Latch child process Overlord spawns.
 *
 * Discovery (`latch-discovery.ts`) already resolves `latch` through `which`
 * plus the documented install locations, because a Finder/launchd launched
 * process — the packaged desktop app, an installed runner service — does not
 * inherit the interactive shell's PATH. The session lifecycle commands
 * (`inspect`, `open`, `stop`, `events`, `send`) did not: they spawned the bare
 * `latch` name and failed with `spawnSync latch ENOENT` on exactly the devices
 * where discovery had just reported Latch as `found`.
 *
 * Everything that spawns Latch now goes through {@link resolveLatchBinaryPath}
 * so a session command can never disagree with discovery about whether Latch
 * exists on this machine.
 */

import { existsSync } from 'node:fs';

import { resolveLatchExecutablePath } from './latch-discovery.ts';
import { DEFAULT_LATCH_EXECUTABLE } from './terminal-profile-types.ts';

/** Resolved absolute paths keyed by the requested executable name. */
const cache = new Map<string, string>();

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Absolute path to the Latch binary, or null when this machine has none.
 *
 * Resolutions are memoized per executable name and revalidated with a cheap
 * existence check, so a 10-second inspect poll does not spawn a `which` per
 * tick, and an uninstall or a moved binary is still noticed.
 */
export function resolveLatchBinaryPath(
  executable?: string | null,
  resolve: (name: string) => string | null = resolveLatchExecutablePath
): string | null {
  const name = trimmed(executable) ?? DEFAULT_LATCH_EXECUTABLE;
  const cached = cache.get(name);
  if (cached) {
    if (existsSync(cached)) return cached;
    cache.delete(name);
  }
  const resolved = resolve(name);
  if (resolved) cache.set(name, resolved);
  return resolved;
}

/**
 * Operator-facing message for a Latch command that cannot run because the
 * binary is missing. It names the executable that was looked for so a custom
 * `executable` setting is distinguishable from a genuinely absent install.
 */
export function latchBinaryMissingMessage(executable?: string | null): string {
  const name = trimmed(executable) ?? DEFAULT_LATCH_EXECUTABLE;
  return `Latch executable "${name}" was not found on this device (checked PATH, ~/.local/bin, and the Homebrew prefixes).`;
}

/** Test seam: drop memoized resolutions. */
export function resetLatchBinaryCache(): void {
  cache.clear();
}
