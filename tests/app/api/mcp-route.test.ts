import { responseStatusDisallowsBody } from '@/app/api/mcp/route';

describe('MCP proxy response handling', () => {
  it('treats 204 responses as bodyless', () => {
    expect(responseStatusDisallowsBody(204)).toBe(true);
  });

  it('treats 205 responses as bodyless', () => {
    expect(responseStatusDisallowsBody(205)).toBe(true);
  });

  it('treats 304 responses as bodyless', () => {
    expect(responseStatusDisallowsBody(304)).toBe(true);
  });

  it('allows bodies for normal 200 responses', () => {
    expect(responseStatusDisallowsBody(200)).toBe(false);
  });
});
