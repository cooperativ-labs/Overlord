import os from 'node:os';
import path from 'node:path';

export type SnapshotRootResolutionOptions = {
  homeDir?: string;
  localAppData?: string | null;
  platform?: NodeJS.Platform;
};

export function resolveManagedSnapshotBaseDirectory(
  options: SnapshotRootResolutionOptions = {}
): string {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();

  if (platform === 'win32') {
    const localAppData =
      options.localAppData ?? process.env.LOCALAPPDATA ?? path.join(homeDir, 'AppData', 'Local');
    return path.join(localAppData, 'Overlord');
  }

  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Overlord');
  }

  return path.join(homeDir, '.local', 'share', 'overlord');
}
