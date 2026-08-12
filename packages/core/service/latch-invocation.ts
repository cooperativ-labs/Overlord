/**
 * Detect a hand-written `latch` invocation in launch text (coo:702).
 *
 * The Latch provider is chosen with the Session toggle, which is the only path
 * that yields a provider session id Overlord can inspect, open, or stop. A
 * `latch` command typed into a pre-command or pre-launch field produces a
 * second, unmapped way to obtain a session — so Overlord warns and points at
 * the toggle. It never rewrites the field: the text belongs to the user, and a
 * silent rewrite of a launch command is worse than a visible warning.
 *
 * Dependency-free by design so the settings UI can import it directly.
 */

/** Subcommands that create or present a session, i.e. the ones that conflict. */
const SESSION_SUBCOMMANDS = new Set(['create', 'open', 'attach', 'run', 'start']);

const SEGMENT_SEPARATORS = /\n|&&|\|\||;|\|/;

/** `FOO=bar` prefixes are environment, not the command being run. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export type LatchInvocationMatch = {
  /** The offending segment, trimmed, for quoting back to the user. */
  command: string;
  /** The `latch` subcommand when one was given, else null. */
  subcommand: string | null;
  /** True when the subcommand creates or presents a session. */
  createsSession: boolean;
};

function commandTokens(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean);
}

function isLatchExecutable(token: string): boolean {
  const withoutQuotes = token.replace(/^['"]|['"]$/g, '');
  const basename = withoutQuotes.split('/').pop() ?? '';
  return basename === 'latch';
}

/**
 * Return the first `latch` invocation in the text, or null. Matches a segment
 * whose command word is `latch` (or a path ending in `/latch`), including after
 * `&&`, `;`, or a pipe, and ignoring leading `VAR=value` assignments.
 */
export function detectLatchInvocation(
  text: string | null | undefined
): LatchInvocationMatch | null {
  if (!text || !text.trim()) return null;

  for (const segment of text.split(SEGMENT_SEPARATORS)) {
    const tokens = commandTokens(segment);
    let index = 0;
    while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index] ?? '')) index += 1;
    const command = tokens[index];
    if (!command || !isLatchExecutable(command)) continue;

    const next = tokens[index + 1];
    const subcommand = next && !next.startsWith('-') ? next : null;
    return {
      command: segment.trim(),
      subcommand,
      createsSession: subcommand !== null && SESSION_SUBCOMMANDS.has(subcommand)
    };
  }

  return null;
}

/** Warning copy shown next to the field, pointing at the Session toggle. */
export function latchInvocationWarning(match: LatchInvocationMatch): string {
  const lead = match.createsSession
    ? `This runs Latch itself (\`${match.command}\`).`
    : `This looks like a Latch command (\`${match.command}\`).`;
  return (
    `${lead} Overlord will run it as written and will not rewrite it, but a session ` +
    'started this way is invisible to Overlord — it has no session id to open, inspect, or stop. ' +
    'Use the Session setting above to run the agent in a persistent Latch session instead.'
  );
}
