import {
  createFollowUpTicketSchema,
  createStandaloneTicketSchema,
  discoverProjectSchema,
  recordWorkSchema,
  searchTicketsSchema,
  spawnSchema
} from '@/lib/overlord/validation';

describe('projectId accepts project names alongside UUIDs', () => {
  const sampleUuid = 'a1b2c3d4-e5f6-4789-8abc-def012345678';

  it('discoverProjectSchema accepts a UUID', () => {
    const result = discoverProjectSchema.parse({ projectId: sampleUuid });
    expect(result.projectId).toBe(sampleUuid);
  });

  it('discoverProjectSchema accepts a project name', () => {
    const result = discoverProjectSchema.parse({ projectId: 'My Project' });
    expect(result.projectId).toBe('My Project');
  });

  it('discoverProjectSchema accepts a project name with special characters', () => {
    const result = discoverProjectSchema.parse({ projectId: 'Backend API (v2)' });
    expect(result.projectId).toBe('Backend API (v2)');
  });

  it('searchTicketsSchema accepts a UUID for projectId', () => {
    const result = searchTicketsSchema.parse({ projectId: sampleUuid });
    expect(result.projectId).toBe(sampleUuid);
  });

  it('searchTicketsSchema accepts a project name for projectId', () => {
    const result = searchTicketsSchema.parse({ projectId: 'Overlord' });
    expect(result.projectId).toBe('Overlord');
  });

  it('spawnSchema accepts a project name for projectId', () => {
    const result = spawnSchema.parse({
      objectives: [{ objective: 'Test task' }],
      agentIdentifier: 'claude-code',
      projectId: 'My Project'
    });
    expect(result.projectId).toBe('My Project');
  });

  it('createStandaloneTicketSchema accepts a project name for projectId', () => {
    const result = createStandaloneTicketSchema.parse({
      objectives: [{ objective: 'Test task' }],
      projectId: 'Mobile App'
    });
    expect(result.projectId).toBe('Mobile App');
  });

  it('createFollowUpTicketSchema accepts a project name for projectId', () => {
    const result = createFollowUpTicketSchema.parse({
      sessionKey: '11111111-2222-4333-8444-555555555555',
      ticketId: '1:899',
      objectives: [{ objective: 'Move this follow-up into another project' }],
      projectId: 'Shared Platform'
    });
    expect(result.projectId).toBe('Shared Platform');
  });

  it('recordWorkSchema accepts a project name for projectId', () => {
    const result = recordWorkSchema.parse({
      objectives: [{ objective: 'Did something' }],
      summary: 'Completed the work',
      agentIdentifier: 'claude-code',
      projectId: 'Backend API'
    });
    expect(result.projectId).toBe('Backend API');
  });

  it('discoverProjectSchema rejects empty projectId without workingDirectory', () => {
    expect(() => discoverProjectSchema.parse({ projectId: '' })).toThrow();
  });

  it('discoverProjectSchema trims whitespace from project name', () => {
    const result = discoverProjectSchema.parse({ projectId: '  My Project  ' });
    expect(result.projectId).toBe('My Project');
  });
});
