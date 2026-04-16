import { resolveTicketDelegate } from '@/lib/overlord/protocol-ticket-delegate';

describe('resolveTicketDelegate', () => {
  it('uses an explicit delegate when provided', () => {
    expect(resolveTicketDelegate(' codex ', 'claude-code')).toBe('codex');
  });

  it('falls back to the current session agent identifier', () => {
    expect(resolveTicketDelegate(undefined, 'claude-code')).toBe('claude-code');
  });

  it('returns null when neither value is available', () => {
    expect(resolveTicketDelegate('', '')).toBeNull();
  });
});
