import { getPublicMcpUrl } from '@/supabase/functions/mcp/helpers/public-url';

describe('getPublicMcpUrl', () => {
  it('prefers the hosted MCP route when OVERLORD_URL is available', () => {
    expect(
      getPublicMcpUrl({
        OVERLORD_URL: 'https://www.ovld.ai',
        NEXT_PUBLIC_SITE_URL: 'https://staging.ovld.ai',
        SUPABASE_URL: 'https://project.supabase.co'
      })
    ).toBe('https://www.ovld.ai/api/mcp');
  });

  it('uses NEXT_PUBLIC_SITE_URL when OVERLORD_URL is absent', () => {
    expect(
      getPublicMcpUrl({
        NEXT_PUBLIC_SITE_URL: 'https://staging.ovld.ai',
        SUPABASE_URL: 'https://project.supabase.co'
      })
    ).toBe('https://staging.ovld.ai/api/mcp');
  });

  it('falls back to the raw edge function only when no platform URL is configured', () => {
    expect(
      getPublicMcpUrl({
        SUPABASE_URL: 'https://project.supabase.co'
      })
    ).toBe('https://project.supabase.co/functions/v1/mcp');
  });
});
