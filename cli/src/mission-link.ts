/**
 * Single source of truth for the terminal ↔ Desktop mission deep link.
 *
 * Nothing else in the CLI should build `overlord://missions/<id>` by hand —
 * launch banners, attach stderr lines, and (later) `ovld protocol mission-link`
 * all go through these helpers.
 */

export type MissionLinkOpts = {
  displayId: string;
  title?: string;
  /**
   * Force OSC 8 on/off. When omitted, follows {@link shouldUseTerminalHyperlinks}
   * against the current process environment and stderr TTY state.
   */
  hyperlink?: boolean;
};

/** Credential-free Desktop deep link for a mission display id or UUID. */
export function missionDeepLink(displayId: string): string {
  return `overlord://missions/${displayId.trim()}`;
}

/** Strip control chars so titles cannot inject terminal escape sequences. */
export function sanitizeTerminalText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Window/tab title: `coo:502 — Title` or just the display id. */
export function missionTerminalTitle({
  displayId,
  title
}: {
  displayId: string;
  title?: string;
}): string {
  const id = sanitizeTerminalText(displayId);
  const trimmedTitle = title ? sanitizeTerminalText(title) : '';
  return trimmedTitle ? `${id} — ${trimmedTitle}` : id;
}

/**
 * Whether OSC 8 hyperlinks should be emitted.
 * Honours `NO_COLOR`, `TERM=dumb`, and `OVERLORD_NO_TERMINAL_LINKS=1`.
 */
export function shouldUseTerminalHyperlinks({
  env = process.env,
  isTty = Boolean(process.stderr.isTTY)
}: {
  env?: NodeJS.ProcessEnv;
  isTty?: boolean;
} = {}): boolean {
  if (!isTty) return false;
  if (env.OVERLORD_NO_TERMINAL_LINKS === '1') return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if ((env.TERM ?? '').toLowerCase() === 'dumb') return false;
  return true;
}

/**
 * One-line mission identity for a terminal.
 *
 * With hyperlinks: OSC 8 wrapping `coo:502 — Title`.
 * Without: `coo:502 · overlord://missions/coo:502` (plus title when present).
 */
export function missionLinkLine({ displayId, title, hyperlink }: MissionLinkOpts): string {
  const id = sanitizeTerminalText(displayId);
  if (!id) return '';
  const link = missionDeepLink(id);
  const label = missionTerminalTitle({ displayId: id, title });
  const useHyperlink =
    hyperlink ??
    shouldUseTerminalHyperlinks({ env: process.env, isTty: Boolean(process.stderr.isTTY) });

  if (useHyperlink) {
    // OSC 8: ESC ] 8 ; ; <uri> ESC \ <text> ESC ] 8 ; ; ESC \
    return `\u001b]8;;${link}\u001b\\${label}\u001b]8;;\u001b\\`;
  }

  const trimmedTitle = title ? sanitizeTerminalText(title) : '';
  return trimmedTitle ? `${id} · ${link} — ${trimmedTitle}` : `${id} · ${link}`;
}

/**
 * Bash prefix that prints the mission banner and sets the terminal title.
 * Safe to splice into `terminalInnerCommand` — uses `printf '%s'` / `'%b'` so
 * AppleScript and `.sh` embedding do not mangle the escapes.
 *
 * The banner is the plain (non-OSC-8) form so Terminal.app users can copy the
 * `overlord://` URL; iTerm2 still cmd-clicks the scheme text. OSC 0 sets the
 * window/tab title as a nice-to-have (Claude Code may overwrite it mid-session).
 */
export function missionBannerShellCommands({
  displayId,
  title
}: {
  displayId: string;
  title?: string;
}): string {
  const id = sanitizeTerminalText(displayId);
  if (!id) return '';
  const plain = missionLinkLine({ displayId: id, title, hyperlink: false });
  const label = missionTerminalTitle({ displayId: id, title });
  const oscTitle = `\\033]0;${label}\\007`;
  return [
    `printf '%s\\n' ${shellSingleQuote(plain)}`,
    `printf '%b' ${shellSingleQuote(oscTitle)}`
  ].join('; ');
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
