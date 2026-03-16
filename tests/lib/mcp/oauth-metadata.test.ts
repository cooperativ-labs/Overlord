import {
  buildAppMcpProtectedResourceMetadata,
  getAppMcpResourceMetadataUrl,
  rewriteBearerResourceMetadata
} from '@/lib/mcp/oauth-metadata';

describe('MCP OAuth metadata helpers', () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.ovld.ai';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://zitmmhvbilhjjdwgxlfm.supabase.co';
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  });

  it('builds protected resource metadata for the public MCP route', () => {
    expect(buildAppMcpProtectedResourceMetadata()).toEqual({
      resource: 'https://www.ovld.ai/api/mcp',
      authorization_servers: ['https://zitmmhvbilhjjdwgxlfm.supabase.co/auth/v1'],
      scopes_supported: ['openid', 'email', 'profile'],
      bearer_methods_supported: ['header']
    });
  });

  it('points resource metadata discovery at the public MCP route', () => {
    expect(getAppMcpResourceMetadataUrl()).toBe(
      'https://www.ovld.ai/.well-known/oauth-protected-resource/api/mcp'
    );
  });

  it('rewrites bearer challenges to the public resource metadata URL', () => {
    expect(
      rewriteBearerResourceMetadata(
        'Bearer resource_metadata="https://zitmmhvbilhjjdwgxlfm.supabase.co/functions/v1/mcp/.well-known/oauth-protected-resource"',
        'https://www.ovld.ai/.well-known/oauth-protected-resource/api/mcp'
      )
    ).toBe(
      'Bearer resource_metadata="https://www.ovld.ai/.well-known/oauth-protected-resource/api/mcp"'
    );
  });

  it('appends resource metadata when the upstream challenge omitted it', () => {
    expect(
      rewriteBearerResourceMetadata(
        'Bearer error="invalid_token"',
        'https://www.ovld.ai/.well-known/oauth-protected-resource/api/mcp'
      )
    ).toBe(
      'Bearer error="invalid_token", resource_metadata="https://www.ovld.ai/.well-known/oauth-protected-resource/api/mcp"'
    );
  });
});
