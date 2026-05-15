import {
  buildPublicToolsCatalogBody,
  getAppMcpToolCatalogUrl,
  MCP_TOOL_CATALOG_PATH,
  PUBLIC_TOOLS_CATALOG_CACHE_CONTROL
} from '@/lib/mcp/public-tools-catalog';

describe('public tools catalog (app)', () => {
  it('uses the well-known catalog path', () => {
    expect(MCP_TOOL_CATALOG_PATH).toBe('/.well-known/overlord-mcp-tools.json');
    expect(getAppMcpToolCatalogUrl('https://www.ovld.ai')).toBe(
      'https://www.ovld.ai/.well-known/overlord-mcp-tools.json'
    );
  });

  it('exposes cache headers for CDN-friendly catalog responses', () => {
    expect(PUBLIC_TOOLS_CATALOG_CACHE_CONTROL).toContain('public');
  });

  it('returns a tools array payload', () => {
    const body = JSON.parse(buildPublicToolsCatalogBody()) as { tools: { name: string }[] };
    expect(body.tools.some(tool => tool.name === 'attach')).toBe(true);
  });
});
