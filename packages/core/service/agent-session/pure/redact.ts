/**
 * Payload reduction — §9 of the connector interaction core.
 *
 * Reduction happens **on the machine, before transmission**, and this module is the whole of
 * it. The table it implements is short enough to state:
 *
 * | Persisted                          | Never persisted                             |
 * | ---------------------------------- | ------------------------------------------- |
 * | Native ids, for correlation        | Transcript paths, and never transcripts     |
 * | Normalized tool name               | Raw tool input                              |
 * | A bounded, redacted summary        | Raw tool or command output                  |
 * | Option ids and labels              | File contents from write/edit payloads      |
 * | Repo-relative paths                | Absolute paths outside the project          |
 *
 * The rule that makes this hold as harnesses add tools faster than we write formatters is
 * **structure, never values**: an unrecognized tool emits its name and the top-level *keys* of
 * its input and nothing else. Key names are structural; values are content. Only a formatter
 * written deliberately for a tool may emit any value from that tool's input, and that decision
 * is visible in a diff.
 *
 * Prompt text is the one deliberate exception, applied by the caller rather than here: follow-up
 * prompts are persisted in full for bound sessions because the activity feed exists to show
 * them. Secret redaction still runs over them.
 */

import { hasNonAscii, safeText } from './text.js';

/**
 * Patterns for credential-shaped material.
 *
 * This is a defense in depth rather than the primary control — the primary control is that raw
 * inputs are not forwarded at all. What reaches here is already a derived summary, and these
 * patterns exist because a shell command *is* the summary for the `shell` formatter, and shell
 * commands carry tokens.
 *
 * Deliberately conservative: a false positive costs a reader some context, a false negative
 * writes a live credential into a database row and a push notification.
 */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'overlord-user-token', pattern: /out_[A-Za-z0-9_-]{8,}/g },
  { name: 'overlord-channel-token', pattern: /osc_[A-Za-z0-9_-]{8,}/g },
  { name: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{16,}/g },
  { name: 'slack-token', pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'aws-access-key', pattern: /A(?:KIA|SIA)[0-9A-Z]{16}/g },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: 'bearer-header', pattern: /(?<=[Bb]earer\s)[A-Za-z0-9._~+/-]{12,}=*/g },
  // `SOMETHING_TOKEN=value`, `--password value`, `api-key: value`. The key half is kept —
  // knowing a command sets DATABASE_PASSWORD is useful; knowing its value is not.
  {
    name: 'assigned-secret',
    pattern:
      /((?:secret|token|passwd|password|api[_-]?key|access[_-]?key|private[_-]?key|credential)[a-z0-9_-]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi
  }
];

export type Redaction = { text: string; redactedPatterns: string[] };

/**
 * Mask credential-shaped substrings, reporting which pattern families fired.
 *
 * The report is not decoration: it goes into the card so a reader knows the rendered command is
 * not literally what will run, which is the difference between a summary and a lie.
 */
export function redactSecrets(value: string): Redaction {
  let text = value;
  const fired: string[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;
    fired.push(name);
    text = text.replace(pattern, (...args) => {
      const groups = args.slice(1, -2).filter(arg => typeof arg === 'string');
      // The assigned-secret pattern captures the key half; keep it and mask only the value.
      return groups.length >= 2 ? `${groups[0]}[redacted]` : '[redacted]';
    });
  }
  return { text, redactedPatterns: fired };
}

export type PathReduction = {
  /** Repo-relative when inside the project; a bare basename otherwise. */
  display: string;
  outsideProject: boolean;
  nonAscii: boolean;
};

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

/**
 * Reduce a filesystem path to something safe to transmit.
 *
 * Inside the project, the repo-relative path is both safe and the most useful thing we can
 * show. Outside it, the *directory structure itself* is content — `/Users/jake/clients/acme/…`
 * discloses a client list — so only the basename survives and the card says plainly that the
 * target is outside the project.
 */
export function reducePath(rawPath: unknown, projectRoot?: string | null): PathReduction | null {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') return null;
  const value = normalizeSeparators(rawPath.trim());
  const root = projectRoot ? normalizeSeparators(projectRoot).replace(/\/+$/, '') : null;

  const isAbsolute = value.startsWith('/') || /^[A-Za-z]:\//.test(value);
  if (root && (value === root || value.startsWith(`${root}/`))) {
    const relative = value === root ? '.' : value.slice(root.length + 1);
    return {
      display: safeText(relative).text,
      outsideProject: false,
      nonAscii: hasNonAscii(relative)
    };
  }
  if (!isAbsolute && !value.startsWith('../')) {
    // Already relative and not climbing out: the harness gave us a repo-relative path.
    return { display: safeText(value).text, outsideProject: false, nonAscii: hasNonAscii(value) };
  }

  const basename = value.split('/').filter(Boolean).pop() ?? value;
  return {
    display: safeText(basename).text,
    outsideProject: true,
    nonAscii: hasNonAscii(value)
  };
}

/**
 * Reduce a URL to scheme, host, and path.
 *
 * The query string is dropped unconditionally. Query parameters routinely carry session tokens,
 * signed URLs, and access keys, and there is no way to tell a safe `?page=2` from a dangerous
 * `?token=…` by inspection that is worth being wrong about.
 */
export function reduceUrl(
  rawUrl: unknown
): { display: string; host: string | null; scheme: string | null; hadQuery: boolean } | null {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return null;
  const raw = rawUrl.trim();
  try {
    const url = new URL(raw);
    const hadQuery = url.search !== '' || url.hash !== '';
    const path = url.pathname === '/' ? '' : url.pathname;
    return {
      display: safeText(`${url.protocol}//${url.host}${path}`).text,
      host: url.host || null,
      scheme: url.protocol.replace(/:$/, ''),
      hadQuery
    };
  } catch {
    // Not parseable as a URL: emit nothing but the fact that something unparseable was there.
    // Echoing the raw string back would reintroduce exactly the query string we just refused.
    return { display: '[unparseable url]', host: null, scheme: null, hadQuery: false };
  }
}

/**
 * The default rule, in one function: the top-level key names of an input object.
 *
 * Sorted so a card is stable across runs, bounded so a model cannot make a card unbounded by
 * emitting a thousand keys, and escaped because a key name is model-controlled too.
 */
export function topLevelKeys(input: unknown, max = 20): { keys: string[]; truncated: boolean } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { keys: [], truncated: false };
  }
  const all = Object.keys(input as Record<string, unknown>)
    .map(key => safeText(key, 60).text)
    .filter(key => key !== '')
    .sort();
  return { keys: all.slice(0, max), truncated: all.length > max };
}

/** Byte length of a string-valued field, without ever carrying the string itself. */
export function byteLength(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  return Buffer.byteLength(value, 'utf8');
}
