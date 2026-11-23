/**
 * `MAJOR.MINOR.PATCH` helpers shared by every harness version gate (Claude Code, Codex,
 * Antigravity). Each gate used to carry a private copy of these two functions.
 */

/** Compare two `MAJOR.MINOR.PATCH` strings: -1, 0 or 1. Missing or non-numeric parts count as 0. */
export function compareSemver(left: string, right: string): number {
  const a = left.split('.').map(part => Number.parseInt(part, 10) || 0);
  const b = right.split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** The first `MAJOR.MINOR.PATCH` in a `--version` line (`codex-cli 0.170.0` → `0.170.0`), or null. */
export function parseSemver(output: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(output);
  return match?.[1] ?? null;
}
