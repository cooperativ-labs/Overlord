import {
  buildPublicToolsCatalogBody,
  isPublicMcpRpcMethod,
  isPublicToolsCatalogRequest
} from '../../../../supabase/functions/mcp/public-catalog.ts';

describe('isPublicMcpRpcMethod', () => {
  it('allows tools/list without auth', () => {
    expect(isPublicMcpRpcMethod('tools/list')).toBe(true);
  });

  it('requires auth for tools/call', () => {
    expect(isPublicMcpRpcMethod('tools/call')).toBe(false);
  });
});

describe('isPublicToolsCatalogRequest', () => {
  it('matches ?resource=tools on the MCP function base URL', () => {
    const url = new URL('https://project.supabase.co/functions/v1/mcp?resource=tools');
    expect(isPublicToolsCatalogRequest(url)).toBe(true);
  });

  it('matches a /tools path suffix when the gateway forwards it', () => {
    const url = new URL('https://project.supabase.co/functions/v1/mcp/tools');
    expect(isPublicToolsCatalogRequest(url)).toBe(true);
  });

  it('does not match unrelated GET requests', () => {
    const url = new URL('https://project.supabase.co/functions/v1/mcp');
    expect(isPublicToolsCatalogRequest(url)).toBe(false);
  });
});

describe('buildPublicToolsCatalogBody', () => {
  it('returns a tools array payload', () => {
    const body = JSON.parse(buildPublicToolsCatalogBody()) as { tools: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
  });
});
