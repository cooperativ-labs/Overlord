import {
  negotiateProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS
} from '@/supabase/functions/mcp/protocol';

describe('MCP protocol version negotiation', () => {
  it('supports Claude current protocol revision', () => {
    expect(negotiateProtocolVersion('2025-11-25')).toBe('2025-11-25');
  });

  it('preserves explicitly supported older revisions', () => {
    expect(negotiateProtocolVersion('2025-06-18')).toBe('2025-06-18');
  });

  it('falls back to latest server-supported revision for unsupported versions', () => {
    expect(negotiateProtocolVersion('2099-01-01')).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });
});
