import { byteLength, redactSecrets } from '../redact.js';
import { escapeControlCharacters, hasNonAscii, MAX_COMMAND_LENGTH, safeText } from '../text.js';

import {
  type DescribeInput,
  type Description,
  normalizeMarkers,
  type RiskMarker
} from './types.js';

/**
 * The shell formatter — the highest-stakes card in the product.
 *
 * A shell command is the one case where the command text *is* the summary: there is no
 * structural reduction of `bash -c '…'` that preserves what a person needs to decide. So this
 * formatter shows the command, and everything around that decision is defensive:
 *
 *  - The command is escaped (a newline cannot split the card), redacted (a token in an
 *    argument does not reach the database), and explicitly truncated.
 *  - `argv0` is extracted separately so the subject line names the program even when the
 *    command is long enough to be clipped.
 *  - Risk markers are matched against the *whole* command, before truncation. A `sudo` 400
 *    characters in still flags, which is exactly where someone would hide one.
 */

const DESTRUCTIVE_PATTERNS: { marker: RiskMarker; pattern: RegExp }[] = [
  { marker: 'destructive', pattern: /\brm\s+(-[A-Za-z]*[rf][A-Za-z]*\s+)+/ },
  { marker: 'destructive', pattern: /\brm\s+-[A-Za-z]*r[A-Za-z]*f|\brm\s+-[A-Za-z]*f[A-Za-z]*r/ },
  { marker: 'destructive', pattern: /\b(?:mkfs|shred|dd)\b/ },
  { marker: 'destructive', pattern: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i },
  { marker: 'destructive', pattern: /\btruncate\s+table\b/i },
  {
    marker: 'irreversible',
    pattern: /\bgit\s+push\b[^|;&]*(?:--force\b|--force-with-lease\b|\s-f\b)/
  },
  { marker: 'irreversible', pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[A-Za-z]*[dfx])/ },
  { marker: 'irreversible', pattern: /\bgit\s+branch\s+-D\b/ },
  { marker: 'network-egress', pattern: /\b(?:curl|wget|nc|ncat|scp|rsync|ssh|ftp|telnet)\b/ },
  { marker: 'sudo', pattern: /(?:^|[\s|;&(])(?:sudo|doas|su)\b/ },
  {
    marker: 'secret-adjacent',
    pattern: /\b(?:\.env|id_rsa|id_ed25519|\.aws\/credentials|\.netrc|keychain)\b/i
  },
  { marker: 'secret-adjacent', pattern: /\b(?:printenv|env)\b\s*(?:\||$)/ }
];

/**
 * Pipe-to-shell gets its own detector rather than a pattern in the table above.
 *
 * `curl … | sh` is not simply "network egress plus a shell": it is remote code execution with
 * no reviewable artifact, and it stays dangerous through every obfuscation of the fetch half
 * (`wget -qO-`, `fetch`, a bare `python -c "urlopen"`). Matching on the *pipe target* rather
 * than the source is what survives that.
 */
const PIPE_TO_SHELL =
  /\|\s*(?:sudo\s+)?(?:ba|z|k|da|fi)?sh\b|\|\s*(?:python[0-9.]*|perl|ruby|node)\b/;

/** Redirect to a path that is neither relative nor obviously inside the project. */
const REDIRECT_OUTSIDE = /(?:^|\s)>{1,2}\s*(\/[^\s;&|]*)/;

function extractArgv0(command: string): string | null {
  // Skip leading `VAR=value` assignments and `sudo`/`env` wrappers so the subject names the
  // program a person would recognize rather than the first token.
  const tokens = command.trim().split(/\s+/);
  for (const token of tokens) {
    if (token === '') continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (token === 'sudo' || token === 'doas' || token === 'env' || token === 'command') continue;
    if (token.startsWith('-')) continue;
    const base = token.split('/').pop() ?? token;
    return safeText(base, 60).text || null;
  }
  return null;
}

function readCommand(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'shell_command', 'commandLine', 'script']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  // Some harnesses hand over argv rather than a command line.
  const argv = record.argv ?? record.args;
  if (Array.isArray(argv) && argv.every(entry => typeof entry === 'string')) {
    return argv.join(' ');
  }
  return null;
}

export function describeShell({ input, projectRoot }: DescribeInput): Description {
  const raw = readCommand(input);
  if (raw === null) {
    return {
      action: 'Run a shell command',
      subject: null,
      detail: null,
      riskMarkers: []
    };
  }

  const markers: (RiskMarker | false | undefined)[] = [];
  for (const { marker, pattern } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(raw)) markers.push(marker);
  }
  if (PIPE_TO_SHELL.test(raw)) {
    markers.push('pipe-to-shell');
    markers.push('network-egress');
  }
  const redirect = REDIRECT_OUTSIDE.exec(raw);
  if (redirect?.[1] && (!projectRoot || !redirect[1].startsWith(projectRoot))) {
    markers.push('outside-project-directory');
  }
  // Tested against the *escaped* form. An embedded newline is already made visible by escaping
  // and is not a homoglyph problem; flagging it as one would make the marker mean two things
  // and therefore nothing.
  if (hasNonAscii(escapeControlCharacters(raw))) markers.push('non-ascii-path');

  const { text: redacted, redactedPatterns } = redactSecrets(raw);
  if (redactedPatterns.length > 0) markers.push('secret-adjacent');
  const { text, truncated } = safeText(redacted, MAX_COMMAND_LENGTH);
  if (truncated) markers.push('truncated');

  return {
    action: 'Run a shell command',
    subject: extractArgv0(raw),
    detail: text,
    riskMarkers: normalizeMarkers(markers),
    // Byte length of the original, so a reader can tell a clipped 210-character command from a
    // clipped 21,000-character one — very different things to be approving.
    ...(truncated ? { keys: [`${byteLength(raw) ?? 0} bytes total`] } : {})
  };
}
