import { resolveSelectedDeviceId } from '@/components/features/projects/ProjectExecutionWorkspaceSelector';

const devices = [{ id: 'local-device' }, { id: 'remote-device' }];

describe('resolveSelectedDeviceId', () => {
  it('preserves a saved remote target in the desktop app', () => {
    expect(
      resolveSelectedDeviceId({
        devices,
        storedDeviceId: 'remote-device',
        matchedDeviceId: 'local-device',
        isElectron: true
      })
    ).toBe('remote-device');
  });

  it('defaults to the matched local target on desktop when there is no valid saved target', () => {
    expect(
      resolveSelectedDeviceId({
        devices,
        storedDeviceId: 'removed-device',
        matchedDeviceId: 'local-device',
        isElectron: true
      })
    ).toBe('local-device');
  });

  it('falls back to the first available target', () => {
    expect(
      resolveSelectedDeviceId({
        devices,
        storedDeviceId: null,
        matchedDeviceId: null,
        isElectron: false
      })
    ).toBe('local-device');
  });

  it('returns null when no targets are available', () => {
    expect(
      resolveSelectedDeviceId({
        devices: [],
        storedDeviceId: null,
        matchedDeviceId: null,
        isElectron: true
      })
    ).toBeNull();
  });
});
