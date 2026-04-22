import { createStandaloneTicketSchema, spawnSchema } from '@/lib/overlord/validation';

describe('personal ticket protocol validation', () => {
  it('accepts personal standalone ticket creation without a project id', () => {
    const parsed = createStandaloneTicketSchema.parse({
      objective: 'Capture a private follow-up',
      personal: true
    });

    expect(parsed.personal).toBe(true);
    expect(parsed.projectId).toBeUndefined();
  });

  it('accepts personal spawn requests without a project id', () => {
    const parsed = spawnSchema.parse({
      objective: 'Start a private ticket',
      personal: true,
      agentIdentifier: 'codex'
    });

    expect(parsed.personal).toBe(true);
    expect(parsed.projectId).toBeUndefined();
  });
});
