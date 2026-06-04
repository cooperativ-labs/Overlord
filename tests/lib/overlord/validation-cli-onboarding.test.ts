import { cliOnboardingSchema } from '@/lib/overlord/validation';

describe('cli-onboarding validation', () => {
  const base = {
    name: 'Agent Smith',
    projectName: 'Acme Web',
    directoryPath: '/home/dev/acme',
    deviceFingerprint: 'fp-123'
  };

  it('accepts a non-invite payload with an organization name', () => {
    const parsed = cliOnboardingSchema.parse({ ...base, organizationName: 'Acme' });

    expect(parsed.organizationName).toBe('Acme');
    expect(parsed.inviteToken).toBeUndefined();
  });

  it('accepts an invite payload without an organization name', () => {
    const parsed = cliOnboardingSchema.parse({ ...base, inviteToken: 'invite-token-123' });

    expect(parsed.inviteToken).toBe('invite-token-123');
    expect(parsed.organizationName).toBeUndefined();
  });

  it('trims the invite token', () => {
    const parsed = cliOnboardingSchema.parse({ ...base, inviteToken: '  invite-token-123  ' });

    expect(parsed.inviteToken).toBe('invite-token-123');
  });

  it('rejects a payload with neither organizationName nor inviteToken', () => {
    expect(() => cliOnboardingSchema.parse(base)).toThrow(/organizationName is required/);
  });

  it('rejects a missing project name', () => {
    expect(() =>
      cliOnboardingSchema.parse({ ...base, projectName: '   ', organizationName: 'Acme' })
    ).toThrow();
  });
});
