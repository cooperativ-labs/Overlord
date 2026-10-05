// Path policy for agent-facing repository reads (contract v152, coo:1108.zg8m).
//
// Every read names a repository-relative path; the target resolves it against
// the registered resource root it was handed by the claim. Two rules apply on
// both sides of the queue: the request is rejected outright when the path is
// absolute or escapes the root lexically, and on the target the *real* path
// (symlinks resolved) must stay inside the root's real path. Sensitive paths
// are never returned as content, whatever the containment answer.

import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export type RelativePathCheck = { ok: true; relativePath: string } | { ok: false; reason: string };

const MAX_RELATIVE_PATH_CHARS = 1024;

/**
 * Normalize an untrusted repository-relative path. Empty means the resource
 * root. Absolute, drive-letter, UNC, NUL-bearing, `..`-escaping and `.git`
 * paths are rejected — a caller never gets to name an absolute location.
 */
export function normalizeRepositoryRelativePath(value: unknown): RelativePathCheck {
  if (value === undefined || value === null) return { ok: true, relativePath: '' };
  if (typeof value !== 'string') return { ok: false, reason: 'Path must be a string.' };
  if (value.length > MAX_RELATIVE_PATH_CHARS) return { ok: false, reason: 'Path is too long.' };
  if (value.includes('\0')) return { ok: false, reason: 'Path contains a NUL byte.' };
  const slashed = value.replace(/\\/g, '/').trim();
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed) || slashed.startsWith('//')) {
    return {
      ok: false,
      reason: 'Absolute paths are not accepted; use a repository-relative path.'
    };
  }
  const normalized = path.posix.normalize(slashed === '' ? '.' : slashed).replace(/\/+$/, '');
  if (normalized === '.' || normalized === '') return { ok: true, relativePath: '' };
  if (normalized === '..' || normalized.startsWith('../')) {
    return { ok: false, reason: 'Path escapes the repository.' };
  }
  if (normalized.split('/').some(segment => segment.toLowerCase() === '.git')) {
    return { ok: false, reason: 'Git metadata is not readable.' };
  }
  return { ok: true, relativePath: normalized };
}

// ---- sensitive paths ------------------------------------------------------

const SENSITIVE_DIRECTORY_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.git']);
const SENSITIVE_PREFIXES = ['.overlord/tmp/'];
const SENSITIVE_BASENAMES = new Set([
  '.env',
  '.envrc',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '_netrc',
  '.pgpass',
  '.git-credentials',
  '.dockercfg',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'secrets.toml'
]);
const TEMPLATE_SUFFIXES = ['.example', '.sample', '.template'];
const SENSITIVE_BASENAME_PATTERNS = [
  /^\.env\..+$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(?!.*\.pub$)/,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk)$/,
  /^credentials.*\.json$/,
  /^service-account.*\.json$/,
  /\.tfstate(\..*)?$/
];

function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]!;
    if (char === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1;
      } else {
        pattern += '[^/]*';
      }
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`, 'i');
}

/** The target's configured extra exclusions (`OVERLORD_REPOSITORY_READ_EXCLUDE`, comma-separated globs). */
export function configuredSensitiveGlobs(env: NodeJS.ProcessEnv = process.env): RegExp[] {
  return (env.OVERLORD_REPOSITORY_READ_EXCLUDE ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(globToRegExp);
}

/**
 * Whether a repository-relative path names a credential or configured
 * sensitive file whose *content* must never leave the target.
 */
export function isSensitiveRepositoryPath(
  relativePath: string,
  extra: readonly RegExp[] = configuredSensitiveGlobs()
): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const lower = normalized.toLowerCase();
  const segments = lower.split('/');
  const basename = segments[segments.length - 1] ?? '';
  if (segments.slice(0, -1).some(segment => SENSITIVE_DIRECTORY_SEGMENTS.has(segment))) {
    return true;
  }
  if (SENSITIVE_PREFIXES.some(prefix => lower.startsWith(prefix))) return true;
  if (extra.some(glob => glob.test(normalized) || glob.test(basename))) return true;
  if (TEMPLATE_SUFFIXES.some(suffix => basename.endsWith(suffix))) return false;
  if (SENSITIVE_BASENAMES.has(basename)) return true;
  return SENSITIVE_BASENAME_PATTERNS.some(pattern => pattern.test(basename));
}

// ---- containment ------------------------------------------------------------

export type ContainedPath =
  | { ok: true; absolutePath: string; relativePath: string; realRoot: string }
  | { ok: false; outcome: 'denied' | 'not_found'; message: string };

/**
 * Resolve a repository-relative path inside `root` on this machine. The real
 * path (symlinks followed) must equal or sit under the root's real path, so a
 * link that points elsewhere — even one committed to the repository — is
 * denied. Sensitive paths are denied by both their requested and real names.
 */
export function resolveContainedRepositoryPath(root: string, relative: unknown): ContainedPath {
  const checked = normalizeRepositoryRelativePath(relative);
  if (!checked.ok) return { ok: false, outcome: 'denied', message: checked.reason };
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { ok: false, outcome: 'not_found', message: 'The resource directory is not present.' };
  }
  const candidate = path.join(realRoot, ...checked.relativePath.split('/').filter(Boolean));
  if (checked.relativePath && isSensitiveRepositoryPath(checked.relativePath)) {
    return { ok: false, outcome: 'denied', message: 'This path is excluded as sensitive.' };
  }
  let realCandidate: string;
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    return { ok: false, outcome: 'not_found', message: 'No such path in the repository.' };
  }
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + path.sep)) {
    return { ok: false, outcome: 'denied', message: 'The path resolves outside the repository.' };
  }
  const realRelative = path.relative(realRoot, realCandidate).split(path.sep).join('/');
  if (
    realRelative &&
    (isSensitiveRepositoryPath(realRelative) ||
      realRelative.split('/').some(segment => segment.toLowerCase() === '.git'))
  ) {
    return { ok: false, outcome: 'denied', message: 'This path is excluded as sensitive.' };
  }
  return { ok: true, absolutePath: realCandidate, relativePath: checked.relativePath, realRoot };
}

/** `statSync` that answers null instead of throwing. */
export function statOrNull(absolutePath: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(absolutePath);
  } catch {
    return null;
  }
}
