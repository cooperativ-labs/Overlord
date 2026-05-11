import { resolveManagedSnapshotBaseDirectory } from '@/lib/snapshot/root';

describe('resolveManagedSnapshotBaseDirectory', () => {
  it('uses the macOS application support directory', () => {
    expect(
      resolveManagedSnapshotBaseDirectory({
        homeDir: '/Users/jake',
        platform: 'darwin'
      })
    ).toBe('/Users/jake/Library/Application Support/Overlord');
  });

  it('uses the Linux XDG data directory shape', () => {
    expect(
      resolveManagedSnapshotBaseDirectory({
        homeDir: '/home/jake',
        platform: 'linux'
      })
    ).toBe('/home/jake/.local/share/overlord');
  });

  it('uses LOCALAPPDATA on Windows when available', () => {
    expect(
      resolveManagedSnapshotBaseDirectory({
        homeDir: 'C:/Users/jake',
        localAppData: 'C:/Users/jake/AppData/Local',
        platform: 'win32'
      })
    ).toBe('C:/Users/jake/AppData/Local/Overlord');
  });
});
