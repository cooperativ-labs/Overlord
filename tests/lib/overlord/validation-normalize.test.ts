import {
  deliverSchema,
  heartbeatSchema,
  hookEventSchema,
  normalizeAgentText,
  updateSchema
} from '@/lib/overlord/validation';

describe('normalizeAgentText', () => {
  it('normalizes CRLF line endings to LF', () => {
    expect(normalizeAgentText('line1\r\nline2')).toBe('line1\nline2');
  });

  it('normalizes bare CR line endings to LF', () => {
    expect(normalizeAgentText('line1\rline2')).toBe('line1\nline2');
  });

  it('strips null bytes', () => {
    expect(normalizeAgentText('before\x00after')).toBe('beforeafter');
  });

  it('leaves backticks, quotes, and dollar signs untouched', () => {
    const text = 'text with `backticks`, "quotes", \'singles\', and $variables';
    expect(normalizeAgentText(text)).toBe(text);
  });

  it('returns plain text unchanged', () => {
    expect(normalizeAgentText('Hello, world!')).toBe('Hello, world!');
  });
});

describe('updateSchema normalization', () => {
  const base = {
    sessionKey: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
    ticketId: '1:1'
  };

  it('normalizes CRLF in summary', () => {
    const result = updateSchema.parse({ ...base, summary: 'line1\r\nline2' });
    expect(result.summary).toBe('line1\nline2');
  });

  it('preserves backticks in summary', () => {
    const result = updateSchema.parse({ ...base, summary: 'ran `npm test` and it passed' });
    expect(result.summary).toBe('ran `npm test` and it passed');
  });
});

describe('deliverSchema normalization', () => {
  const base = {
    sessionKey: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
    ticketId: '1:1'
  };

  it('normalizes CRLF in summary', () => {
    const result = deliverSchema.parse({ ...base, summary: 'done\r\nnext steps' });
    expect(result.summary).toBe('done\nnext steps');
  });

  it('normalizes CRLF in artifact content', () => {
    const result = deliverSchema.parse({
      ...base,
      summary: 'done',
      artifacts: [{ type: 'note', label: 'Note', content: 'line1\r\nline2' }]
    });
    expect(result.artifacts[0].content).toBe('line1\nline2');
  });
});

describe('heartbeatSchema normalization', () => {
  const base = {
    sessionKey: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
    ticketId: '1:1'
  };

  it('normalizes CRLF in note', () => {
    const result = heartbeatSchema.parse({ ...base, note: 'line1\r\nline2' });
    expect(result.note).toBe('line1\nline2');
  });
});

describe('hookEventSchema normalization', () => {
  const base = {
    hookType: 'UserPromptSubmit' as const,
    ticketId: '1:1'
  };

  it('normalizes CRLF in prompt', () => {
    const result = hookEventSchema.parse({ ...base, prompt: 'line1\r\nline2', turnIndex: 2 });
    expect(result.prompt).toBe('line1\nline2');
  });

  it('allows Stop hook events without a prompt', () => {
    const result = hookEventSchema.parse({ hookType: 'Stop', ticketId: '1:1' });
    expect(result.prompt).toBeUndefined();
  });

  it('accepts externalSessionId on hook events', () => {
    const result = hookEventSchema.parse({
      ...base,
      turnIndex: 2,
      externalSessionId: 'claude-session-123'
    });
    expect(result.externalSessionId).toBe('claude-session-123');
  });
});
