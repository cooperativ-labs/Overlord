/**
 * Latch `SessionLookupError::NotFound` / `UnknownName`, with or without the
 * clap/anyhow `Error:` prefix written to stderr. Kept free of Node imports so
 * the mission-panel client can classify prune/remove without bundling spawn.
 */
export function isLatchSessionAbsentMessage(text: string): boolean {
  const normalized = text.replace(/\r/g, '').trim();
  return /(?:error:\s*)?no session(?: named)? `[^`]+`/i.test(normalized);
}

export class LatchSessionCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LatchSessionCommandError';
  }
}

/**
 * Latch has no metadata for this session (prune/remove). Distinct from a
 * generic command failure so the mission panel can hide the card instead of
 * showing Latch's raw "no session" error as a reachability problem.
 */
export class LatchSessionAbsentError extends LatchSessionCommandError {
  constructor(message: string) {
    super(message);
    this.name = 'LatchSessionAbsentError';
  }
}

export function latchSessionCommandError(detail: string): LatchSessionCommandError {
  const message = detail || 'Latch command failed.';
  return isLatchSessionAbsentMessage(message)
    ? new LatchSessionAbsentError(message)
    : new LatchSessionCommandError(message);
}
