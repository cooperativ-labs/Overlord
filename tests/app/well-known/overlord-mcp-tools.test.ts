import { GET, OPTIONS } from '@/app/.well-known/overlord-mcp-tools.json/route';

describe('GET /.well-known/overlord-mcp-tools.json', () => {
  it('returns the public tools catalog', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as { tools: { name: string }[] };
    expect(body.tools.some(tool => tool.name === 'attach')).toBe(true);
    expect(response.headers.get('cache-control')).toContain('public');
  });

  it('supports CORS preflight', async () => {
    const response = await OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
