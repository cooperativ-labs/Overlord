import os from 'node:os';
import path from 'node:path';

/**
 * GUI apps (Electron) often start with a minimal PATH. Prepend typical locations
 * for Homebrew, Linuxbrew, cargo, and user-local bins so CLIs like `jj` resolve.
 */
export function prependUserCliBinsToPath(existingPath: string | undefined): string {
  const home = os.homedir();
  const segments =
    process.platform === 'win32'
      ? [
          path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links'),
          path.join(home, 'scoop', 'shims'),
          path.join(process.env.USERPROFILE ?? home, '.cargo', 'bin')
        ]
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          path.join(home, '.local', 'bin'),
          path.join(home, 'bin'),
          path.join(home, '.cargo', 'bin')
        ];

  const prefix = segments.filter(Boolean).join(path.delimiter);
  if (!existingPath?.trim()) return prefix;
  return `${prefix}${path.delimiter}${existingPath}`;
}

export function envWithUserCliPath(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    PATH: prependUserCliBinsToPath(base.PATH)
  };
}
