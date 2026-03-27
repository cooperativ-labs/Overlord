import {
  forwardHeaders,
  responseStatusDisallowsBody,
  shouldRejectGetAsUnsupportedStream
} from '@/app/api/mcp/route';

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

describe('MCP GET negotiation', () => {
  it('rejects SSE-capable GET probes with 405 behavior', () => {
    expect(shouldRejectGetAsUnsupportedStream('text/event-stream')).toBe(true);
    expect(shouldRejectGetAsUnsupportedStream('application/json, text/event-stream')).toBe(true);
  });

  it('keeps metadata fallback for non-stream GET requests', () => {
    expect(shouldRejectGetAsUnsupportedStream('application/json')).toBe(false);
    expect(shouldRejectGetAsUnsupportedStream(null)).toBe(false);
  });
});

describe('MCP proxy header forwarding', () => {
  it('forwards Accept to the upstream edge function', () => {
    const headers = forwardHeaders(
      new Request('https://www.ovld.ai/api/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json'
        },
        body: '{}'
      })
    ) as Record<string, string>;

    expect(headers.accept).toBe('application/json, text/event-stream');
  });
});
