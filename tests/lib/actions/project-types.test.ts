import {
  emptyProjectSshSettings,
  resolveVisibleProjectSshSettings
} from '@/lib/actions/project-types';

describe('resolveVisibleProjectSshSettings', () => {
  const sshSettings = {
    sshCommand: 'ssh jake@example.com',
    remoteWorkingDirectory: '/srv/app',
    sshHost: 'example.com',
    sshPort: 22,
    sshUser: 'jake',
    sshAuthMethod: 'agent' as const,
    sshPrivateKeyPath: null
  };

  it('returns SSH settings when the feature is enabled', () => {
    expect(resolveVisibleProjectSshSettings(sshSettings, { sshEnabled: true })).toEqual(
      sshSettings
    );
  });

  it('clears SSH settings when the feature is disabled', () => {
    expect(resolveVisibleProjectSshSettings(sshSettings, { sshEnabled: false })).toEqual(
      emptyProjectSshSettings()
    );
  });
});
