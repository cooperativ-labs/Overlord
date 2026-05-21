import { resolveTicketDelegate } from '@/lib/overlord/protocol-ticket-delegate';

describe('resolveTicketDelegate', () => {
  it('uses an explicit delegate when provided', () => {
    expect(resolveTicketDelegate(' codex ', null, 'claude-code')).toBe('codex');
  });

  it('falls back to the model identifier', () => {
    expect(resolveTicketDelegate(undefined, 'gpt-4', 'claude-code')).toBe('gpt-4');
  });

  it('falls back to the agent identifier', () => {
    expect(resolveTicketDelegate(undefined, undefined, 'claude-code')).toBe('claude-code');
  });

  it('returns null when no value is available', () => {
    expect(resolveTicketDelegate('', '', '')).toBeNull();
  });
});
