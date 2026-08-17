/**
 * Latch `SessionLookupError::NotFound` / `UnknownName`, with or without the
 * clap/anyhow `Error:` prefix written to stderr. Kept free of Node imports so
 * the mission-panel client can classify prune/remove without bundling spawn.
 */
export function isLatchSessionAbsentMessage(text: string): boolean {
  const normalized = text.replace(/\r/g, '').trim();
  return /(?:error:\s*)?no session(?: named)? `[^`]+`/i.test(normalized);
}
