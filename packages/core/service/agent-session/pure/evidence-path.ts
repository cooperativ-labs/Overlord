import path from 'node:path';

/** Exact workspace-relative evidence path ceiling shared by normalization and sealing. */
export const MAX_EVIDENCE_PATH_LENGTH = 2_000;
const MAX_EVIDENCE_INPUT_LENGTH = 4_096;

export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasUnsafePathCharacters(value: string): boolean {
  return hasControlCharacters(value) || value.includes('\\');
}

/** Validate an already-relative evidence path without rewriting its literal filename. */
export function isExactEvidencePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (
    value.length === 0 ||
    value.length > MAX_EVIDENCE_PATH_LENGTH ||
    value !== value.trim() ||
    hasUnsafePathCharacters(value)
  ) {
    return false;
  }
  const slashPath = path.sep === '\\' ? value.replace(/\\/g, '/') : value;
  if (path.posix.isAbsolute(slashPath) || /^[a-z]:/i.test(slashPath)) return false;
  if (slashPath === '.' || slashPath === '..' || slashPath.startsWith('../')) return false;
  return path.posix.normalize(slashPath) === slashPath;
}

/**
 * Reduce a connector-declared edit path to exact lexical evidence.
 *
 * Unlike presentation `reducePath`, this never trims, collapses, truncates, or
 * basename-reduces. Absolute candidates must be lexically inside the declared
 * project root; relative candidates must already be canonical and non-traversing.
 * Symlink/case containment and ignore policy remain the local ledger's job.
 */
export function reduceEvidencePath(rawPath: unknown, projectRoot?: string | null): string | null {
  if (
    typeof rawPath !== 'string' ||
    rawPath.length === 0 ||
    rawPath.length > MAX_EVIDENCE_INPUT_LENGTH ||
    rawPath !== rawPath.trim() ||
    hasControlCharacters(rawPath) ||
    (path.sep === '/' && rawPath.includes('\\'))
  ) {
    return null;
  }

  const absolute = path.isAbsolute(rawPath);
  // A foreign-platform absolute path cannot be safely scoped by this host.
  if (!absolute && (/^[a-z]:[\\/]/i.test(rawPath) || rawPath.startsWith('\\\\'))) return null;

  let relative = rawPath;
  if (absolute) {
    if (!projectRoot || !path.isAbsolute(projectRoot) || hasControlCharacters(projectRoot)) {
      return null;
    }
    if (path.normalize(rawPath) !== rawPath) return null;
    relative = path.relative(path.normalize(projectRoot), rawPath);
  }

  if (path.sep === '\\') relative = relative.replace(/\\/g, '/');
  return isExactEvidencePath(relative) ? relative : null;
}
