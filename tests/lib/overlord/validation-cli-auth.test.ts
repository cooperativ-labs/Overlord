import {
  agentTokenCreateSchema,
  cliLoginRequestSchema,
  cliLoginVerifySchema,
  cliSignupRequestSchema,
  cliSignupVerifySchema
} from '@/lib/overlord/validation';

describe('CLI auth validation schemas', () => {
  describe('cliSignupRequestSchema', () => {
    it('accepts a minimal email + name payload and normalizes the email', () => {
      const parsed = cliSignupRequestSchema.parse({
        email: '  Agent@Example.COM ',
        name: 'Build Agent'
      });
      expect(parsed.email).toBe('agent@example.com');
      expect(parsed.name).toBe('Build Agent');
      expect(parsed.password).toBeUndefined();
    });

    it('accepts an optional password and invite token', () => {
      const parsed = cliSignupRequestSchema.parse({
        email: 'a@b.com',
        name: 'A',
        password: 'hunter2hunter2',
        inviteToken: 'tok-123'
      });
      expect(parsed.password).toBe('hunter2hunter2');
      expect(parsed.inviteToken).toBe('tok-123');
    });

    it('rejects an invalid email', () => {
      expect(() => cliSignupRequestSchema.parse({ email: 'not-an-email', name: 'A' })).toThrow();
    });

    it('rejects a missing name', () => {
      expect(() => cliSignupRequestSchema.parse({ email: 'a@b.com', name: '   ' })).toThrow();
    });

    it('rejects a too-short password', () => {
      expect(() =>
        cliSignupRequestSchema.parse({ email: 'a@b.com', name: 'A', password: 'short' })
      ).toThrow();
    });

    it('rejects a password longer than 72 bytes', () => {
      expect(() =>
        cliSignupRequestSchema.parse({ email: 'a@b.com', name: 'A', password: 'x'.repeat(73) })
      ).toThrow();
    });
  });

  describe('cliSignupVerifySchema', () => {
    it('accepts an 8-digit code', () => {
      const parsed = cliSignupVerifySchema.parse({ email: 'a@b.com', token: '12345678' });
      expect(parsed.token).toBe('12345678');
    });

    it('accepts a 6-digit code', () => {
      expect(cliSignupVerifySchema.parse({ email: 'a@b.com', token: '123456' }).token).toBe(
        '123456'
      );
    });

    it('rejects a non-numeric or wrong-length code', () => {
      expect(() => cliSignupVerifySchema.parse({ email: 'a@b.com', token: 'abcd1234' })).toThrow();
      expect(() => cliSignupVerifySchema.parse({ email: 'a@b.com', token: '12345' })).toThrow();
    });
  });

  describe('cliLoginRequestSchema / cliLoginVerifySchema', () => {
    it('normalizes the login email', () => {
      expect(cliLoginRequestSchema.parse({ email: 'USER@X.IO' }).email).toBe('user@x.io');
    });

    it('requires a code on verify', () => {
      expect(() => cliLoginVerifySchema.parse({ email: 'a@b.com' })).toThrow();
      expect(cliLoginVerifySchema.parse({ email: 'a@b.com', token: '12345678' }).token).toBe(
        '12345678'
      );
    });
  });

  describe('agentTokenCreateSchema', () => {
    it('accepts and trims a label', () => {
      expect(agentTokenCreateSchema.parse({ label: '  CLI: host  ' }).label).toBe('CLI: host');
    });

    it('rejects an empty or overlong label', () => {
      expect(() => agentTokenCreateSchema.parse({ label: '   ' })).toThrow();
      expect(() => agentTokenCreateSchema.parse({ label: 'x'.repeat(81) })).toThrow();
    });
  });
});
