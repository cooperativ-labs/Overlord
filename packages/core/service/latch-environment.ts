/**
 * Environment guarantee for every Latch child process Overlord spawns.
 *
 * Latch separates tmux format fields with the U+001F unit separator. When the
 * tmux client runs without a UTF-8 locale — the default for Finder/launchd
 * launched processes such as the packaged desktop app or an installed runner
 * service — tmux sanitizes that control character to `_` in its output and
 * Latch can no longer split session rows, failing every `inspect`/`list` with
 * "tmux returned an unexpected session row". Spawning Latch with a UTF-8
 * locale keeps the separator intact regardless of how the parent was started.
 */

const UTF8_LOCALE_PATTERN = /utf-?8/i;

function isUtf8Locale(value: string | undefined): boolean {
  return typeof value === 'string' && UTF8_LOCALE_PATTERN.test(value);
}

/**
 * Return a child environment whose effective `LC_CTYPE` category is UTF-8.
 *
 * An already-configured UTF-8 locale is left untouched. Otherwise `LC_CTYPE`
 * is set to the platform's always-available UTF-8 locale, and a conflicting
 * non-UTF-8 `LC_ALL` (which would override `LC_CTYPE`) is dropped.
 */
export function latchChildEnvironment({
  baseEnv = process.env,
  platform = process.platform
}: {
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
} = {}): NodeJS.ProcessEnv {
  const effective = baseEnv.LC_ALL ?? baseEnv.LC_CTYPE ?? baseEnv.LANG;
  if (isUtf8Locale(effective)) return { ...baseEnv };

  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    // macOS ships the bare `UTF-8` locale; glibc systems ship `C.UTF-8`.
    LC_CTYPE: platform === 'darwin' ? 'UTF-8' : 'C.UTF-8'
  };
  if (env.LC_ALL !== undefined && !isUtf8Locale(env.LC_ALL)) delete env.LC_ALL;
  return env;
}
