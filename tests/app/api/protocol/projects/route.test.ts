jest.mock('@/lib/overlord/protocol-auth', () => ({
  resolveAgentToken: jest.fn()
}));
jest.mock('@/supabase/utils/service-role');

let GET: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ GET } = await import('@/app/api/protocol/projects/route'));
});

function mockAuth() {
  const { resolveAgentToken } = jest.requireMock('@/lib/overlord/protocol-auth');
  resolveAgentToken.mockResolvedValue({
    context: { organizationId: 1, userId: 'user-1' }
  });
}

function buildProjectsSupabase(data: unknown[] | null, error: { message: string } | null = null) {
  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    order: jest.fn(() => query),
    then: undefined
  };

  query.order = jest
    .fn(() => query)
    .mockImplementationOnce(() => query)
    .mockImplementationOnce(async () => ({ data, error }));

  return {
    from: jest.fn(() => query)
  };
}

describe('GET /api/protocol/projects', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth();
  });

  it('normalizes organization relations shaped as arrays, objects, or null', async () => {
    const supabase = buildProjectsSupabase([
      {
        id: 'project-1',
        name: 'Alpha',
        organization_id: 1,
        organization: [{ name: 'Org A' }]
      },
      {
        id: 'project-2',
        name: 'Beta',
        organization_id: 1,
        organization: { name: 'Org B' }
      },
      {
        id: 'project-3',
        name: 'Gamma',
        organization_id: 1,
        organization: null
      }
    ]);
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await GET(new Request('http://localhost/api/protocol/projects'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      count: 3,
      projects: [
        {
          id: 'project-1',
          name: 'Alpha',
          organizationId: 1,
          organizationName: 'Org A'
        },
        {
          id: 'project-2',
          name: 'Beta',
          organizationId: 1,
          organizationName: 'Org B'
        },
        {
          id: 'project-3',
          name: 'Gamma',
          organizationId: 1,
          organizationName: null
        }
      ]
    });
  });
});
