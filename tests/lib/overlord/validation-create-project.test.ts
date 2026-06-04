import { createProjectSchema } from '@/lib/overlord/validation';

describe('create-project protocol validation', () => {
  it('accepts a bare project with only a name', () => {
    const parsed = createProjectSchema.parse({ name: 'Acme Web' });

    expect(parsed.name).toBe('Acme Web');
    expect(parsed.directoryPath).toBeUndefined();
    expect(parsed.deviceFingerprint).toBeUndefined();
  });

  it('trims the project name and accepts an optional color', () => {
    const parsed = createProjectSchema.parse({ name: '  Acme Web  ', color: '#112233' });

    expect(parsed.name).toBe('Acme Web');
    expect(parsed.color).toBe('#112233');
  });

  it('accepts one-step directory registration with a device fingerprint', () => {
    const parsed = createProjectSchema.parse({
      name: 'Acme Web',
      directoryPath: '/home/dev/acme',
      deviceFingerprint: 'fp-123',
      isPrimary: true
    });

    expect(parsed.directoryPath).toBe('/home/dev/acme');
    expect(parsed.deviceFingerprint).toBe('fp-123');
    expect(parsed.isPrimary).toBe(true);
  });

  it('rejects a directory without a device fingerprint', () => {
    expect(() =>
      createProjectSchema.parse({ name: 'Acme Web', directoryPath: '/home/dev/acme' })
    ).toThrow(/deviceFingerprint is required/);
  });

  it('rejects an empty project name', () => {
    expect(() => createProjectSchema.parse({ name: '   ' })).toThrow();
  });
});
