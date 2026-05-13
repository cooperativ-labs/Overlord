import { GET } from '@/app/api/projects/[projectId]/file-changes/route';

jest.mock('@/supabase/utils/server');
jest.mock('@/app/api/projects/_lib');

const PROJECT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_ID = 'user-0001';
const ORG_ID = 1;

function makeRpcRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'fc-0001',
    file_name: 'foo.ts',
    file_path: 'apps/web/foo.ts',
    label: 'Added foo',
    summary: 'Added foo',
    why: 'needed',
    impact: 'new feature',
    change_kind: 'edit',
    attribution_source: 'agent',
    confidence: 'high',
    hunks: [],
    created_at: '2026-05-13T00:00:00Z',
    updated_at: '2026-05-13T00:00:00Z',
    ticket_id: 'ticket-0001',
    event_id: 'event-0001',
    session_id: 'session-0001',
    checkpoint_id: null,
    objective_id: null,
    ticket_data: {
      id: 'ticket-0001',
      ticket_id: '1:42',
      title: 'My ticket',
      status: 'execute',
      project_id: PROJECT_ID,
      status_type: 'execute'
    },
    ...overrides
  };
}

function buildSupabaseMock(rpcRows: unknown[] = [], rpcError: unknown = null) {
  const chainable = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: { id: PROJECT_ID, organization_id: ORG_ID },
      error: null
    })
  };

  const rpc = jest.fn().mockResolvedValue({ data: rpcRows, error: rpcError });

  const fromImpl = jest.fn((table: string) => {
    if (table === 'projects') return chainable;
    // ticket_events, agent_sessions, project_checkpoints, objectives
    return {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      // for objectives with .order()
      mockResolvedValue: jest.fn()
    };
  });

  // A chainable mock where every method returns `this` AND the object itself
  // is a Promise that resolves to { data: [], error: null }.
  // This lets arbitrary .select().in().order() chains all resolve cleanly.
  const emptyResult = { data: [] as unknown[], error: null };
  const secondaryChain: Record<string, unknown> = {
    then: (resolve: (v: typeof emptyResult) => void) => Promise.resolve(emptyResult).then(resolve)
  };
  const chainMethod = jest.fn(() => secondaryChain);
  secondaryChain.select = chainMethod;
  secondaryChain.in = chainMethod;
  secondaryChain.order = jest.fn(() => Promise.resolve(emptyResult));
  fromImpl.mockImplementation((table: string) => {
    if (table === 'projects') return chainable;
    return secondaryChain;
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } } })
    },
    from: fromImpl,
    rpc
  };
}

function makeRequest(params: Record<string, string | string[]> = {}) {
  const url = new URL(`http://localhost/api/projects/${PROJECT_ID}/file-changes`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, v);
    } else {
      url.searchParams.set(key, value);
    }
  }
  return new Request(url.toString());
}

async function callRoute(
  request: Request,
  supabaseMock: ReturnType<typeof buildSupabaseMock>
) {
  const { createClientForRequest } = jest.requireMock('@/supabase/utils/server');
  const { assertOrgMembership } = jest.requireMock('@/app/api/projects/_lib');
  createClientForRequest.mockResolvedValue(supabaseMock);
  assertOrgMembership.mockResolvedValue(true);

  const ctx = { params: Promise.resolve({ projectId: PROJECT_ID }) };
  return GET(request, ctx);
}

describe('GET /api/projects/[projectId]/file-changes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls rpc with the generated path variants and returns shaped fileChanges', async () => {
    const rpcRow = makeRpcRow();
    const mock = buildSupabaseMock([rpcRow]);
    const req = makeRequest({ filePath: 'apps/web/foo.ts', repoRoot: '/home/user/repo' });

    const res = await callRoute(req, mock);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith('get_project_file_changes', {
      p_project_id: PROJECT_ID,
      p_file_paths: expect.arrayContaining(['apps/web/foo.ts']),
      p_include_completed: false
    });

    expect(body.fileChanges).toHaveLength(1);
    const fc = body.fileChanges[0];
    expect(fc.id).toBe('fc-0001');
    expect(fc.ticket).toMatchObject({
      id: 'ticket-0001',
      ticket_id: '1:42',
      title: 'My ticket',
      status: 'execute',
      status_type: 'execute'
    });
    expect(fc.ticket.latest_objective_agent).toBeNull();
  });

  it('passes all variants for 54 paths (≤1000 total) without chunking', async () => {
    const paths = Array.from({ length: 54 }, (_, i) => `apps/web/component-${i}.tsx`);
    const mock = buildSupabaseMock([]);
    const req = makeRequest({ filePath: paths });

    await callRoute(req, mock);

    const [[, rpcArgs]] = mock.rpc.mock.calls;
    // Each path produces up to 3 variants (raw, normalized, ./normalized)
    expect(rpcArgs.p_file_paths.length).toBeGreaterThanOrEqual(54);
    expect(rpcArgs.p_file_paths.length).toBeLessThanOrEqual(1000);
    // rpc called exactly once — no chunking
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it('passes all variants for paths with long absolute prefixes', async () => {
    const longRoot = '/home/user/very-long-directory-name'.repeat(3);
    const paths = Array.from({ length: 10 }, (_, i) => `${longRoot}/apps/web/file-${i}.ts`);
    const mock = buildSupabaseMock([]);
    const req = makeRequest({
      filePath: paths,
      repoRoot: longRoot,
      workingDirectory: longRoot
    });

    await callRoute(req, mock);

    expect(mock.rpc).toHaveBeenCalledTimes(1);
    const [[, rpcArgs]] = mock.rpc.mock.calls;
    expect(rpcArgs.p_file_paths.length).toBeGreaterThan(10);
  });

  it('passes includeCompleted=false by default', async () => {
    const mock = buildSupabaseMock([]);
    const req = makeRequest({ filePath: 'src/a.ts' });

    await callRoute(req, mock);

    expect(mock.rpc).toHaveBeenCalledWith(
      'get_project_file_changes',
      expect.objectContaining({ p_include_completed: false })
    );
  });

  it('passes includeCompleted=true when query param set', async () => {
    const mock = buildSupabaseMock([]);
    const req = makeRequest({ filePath: 'src/a.ts', includeCompleted: 'true' });

    await callRoute(req, mock);

    expect(mock.rpc).toHaveBeenCalledWith(
      'get_project_file_changes',
      expect.objectContaining({ p_include_completed: true })
    );
  });

  it('returns 500 with opaque message on rpc error, logs full context', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mock = buildSupabaseMock([], { code: 'PGRST301', message: 'Bad Request' });
    const req = makeRequest({ filePath: 'src/a.ts' });

    const res = await callRoute(req, mock);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to load file changes.');

    expect(consoleSpy).toHaveBeenCalledWith(
      '[file-changes] rpc error',
      expect.objectContaining({
        projectId: PROJECT_ID,
        filePathCount: 1,
        filePathVariantCount: expect.any(Number),
        code: 'PGRST301',
        message: 'Bad Request'
      })
    );

    consoleSpy.mockRestore();
  });

  it('returns empty fileChanges when no paths provided', async () => {
    const mock = buildSupabaseMock([]);
    const req = makeRequest();

    const res = await callRoute(req, mock);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.fileChanges).toEqual([]);
    expect(mock.rpc).toHaveBeenCalledWith(
      'get_project_file_changes',
      expect.objectContaining({ p_file_paths: [] })
    );
  });

  it('deduplicates file path variants before passing to rpc', async () => {
    // Same path twice → variants deduped
    const mock = buildSupabaseMock([]);
    const req = makeRequest({ filePath: ['src/a.ts', 'src/a.ts'] });

    await callRoute(req, mock);

    const [[, rpcArgs]] = mock.rpc.mock.calls;
    const variants: string[] = rpcArgs.p_file_paths;
    expect(variants.length).toBe(new Set(variants).size);
  });

  it('includes ticket metadata including status_type from rpc ticket_data', async () => {
    const rpcRow = makeRpcRow({
      ticket_data: {
        id: 'ticket-complete',
        ticket_id: '1:99',
        title: 'Done ticket',
        status: 'done',
        project_id: PROJECT_ID,
        status_type: 'complete'
      }
    });
    const mock = buildSupabaseMock([rpcRow]);
    const req = makeRequest({ filePath: 'apps/web/foo.ts', includeCompleted: 'true' });

    const res = await callRoute(req, mock);
    const body = await res.json();

    expect(body.fileChanges[0].ticket.status_type).toBe('complete');
    expect(body.fileChanges[0].ticket.status).toBe('done');
  });
});
