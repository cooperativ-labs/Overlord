import { spawnSync } from 'node:child_process';

/**
 * Antigravity hook health for `ovld agent-setup antigravity` and `ovld doctor`.
 *
 * The Overlord plugin's hooks read `hookEventName`, `cwd` and `toolCall.id`, which agy adds to
 * hook input in 1.5.4 (connectors/adapters/antigravity/harness-capabilities.yaml `versionRange`).
 * An older agy still runs the hooks, but its payloads name no event, so prompts and file edits
 * are not captured. That is worth a warning, never a failed install.
 */
export const ANTIGRAVITY_HOOK_MIN_VERSION = '1.5.4';

export function detectAgyVersion(binary = 'agy'): string | null {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 10_000 });
  if (result.error || result.status !== 0) return null;
  const match = /(\d+\.\d+\.\d+)/.exec(`${result.stdout ?? ''}`);
  return match ? (match[1] as string) : null;
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** A warning when the installed agy predates the hook fields the connector reads. */
export function antigravityHookVersionWarnings(agyVersion: string | null): string[] {
  if (!agyVersion) return [];
  if (compareVersions(agyVersion, ANTIGRAVITY_HOOK_MIN_VERSION) >= 0) return [];
  return [
    `agy ${agyVersion} is older than ${ANTIGRAVITY_HOOK_MIN_VERSION}: its hook payloads carry no ` +
      'event name, so Overlord cannot capture prompts or file edits in Antigravity. ' +
      'Run `agy update`.'
  ];
}
