import {
  assertCanManagePrimary,
  canManagePrimary,
  clearTargetPrimary,
  getPrimaryProjectResourceDirectoriesByProjectId,
  resolveTargetOwnership,
  shouldAutoPrimary,
  targetHasPrimaryResourceDirectory
} from '@/lib/resource-directories/primary-resource';

const USER_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const PROJECT = 'pppppppp-0000-4000-8000-000000000001';
const TARGET = 'tttttttt-0000-4000-8000-000000000001';

type AnyResult = { data: unknown; error: unknown };

function makeChain(result: AnyResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'neq']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(async () => result);
  chain.single = jest.fn(async () => result);
  chain.then = (resolve: (value: AnyResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain as any;
}

function makeSupabase(handlers: Record<string, () => any>) {
  return {
    from: jest.fn((table: string) => {
      const handler = handlers[table];
      if (!handler) throw new Error(`unexpected table: ${table}`);
      return handler();
    })
  } as any;
}

describe('getPrimaryProjectResourceDirectoriesByProjectId', () => {
  it('resolves one primary per project without filtering by user_id', async () => {
    const chain = makeChain({
      data: [
        { project_id: PROJECT, execution_target_id: TARGET, directory_path: '/a' },
        { project_id: 'p2', execution_target_id: 't2', directory_path: '/b' }
      ],
      error: null
    });
    const supabase = makeSupabase({ project_resource_directories: () => chain });

    const result = await getPrimaryProjectResourceDirectoriesByProjectId(supabase, {
      userId: USER_A,
      projectIds: [PROJECT, 'p2']
    });

    expect(result.get(PROJECT)?.directoryPath).toBe('/a');
    expect(result.get('p2')?.directoryPath).toBe('/b');
    // The user filter must be dropped: primary is target-scoped.
    expect(chain.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
    expect(chain.eq).toHaveBeenCalledWith('is_primary', true);
  });

  it('returns an empty map when no projectIds are given', async () => {
    const supabase = makeSupabase({});
    const result = await getPrimaryProjectResourceDirectoriesByProjectId(supabase, {
      userId: USER_A,
      projectIds: []
    });
    expect(result.size).toBe(0);
  });
});

describe('shouldAutoPrimary / targetHasPrimaryResourceDirectory', () => {
  it('auto-primaries when no primary currently exists', async () => {
    const supabase = makeSupabase({
      project_resource_directories: () => makeChain({ data: [], error: null })
    });
    await expect(
      shouldAutoPrimary(supabase, { projectId: PROJECT, executionTargetId: TARGET })
    ).resolves.toBe(true);
  });

  it('does not auto-primary when a primary already exists', async () => {
    const supabase = makeSupabase({
      project_resource_directories: () => makeChain({ data: [{ id: 'x' }], error: null })
    });
    await expect(
      targetHasPrimaryResourceDirectory(supabase, { projectId: PROJECT, executionTargetId: TARGET })
    ).resolves.toBe(true);
    await expect(
      shouldAutoPrimary(supabase, { projectId: PROJECT, executionTargetId: TARGET })
    ).resolves.toBe(false);
  });
});

describe('resolveTargetOwnership', () => {
  it('returns the org id and owner for the project org', async () => {
    const supabase = makeSupabase({
      projects: () => makeChain({ data: { organization_id: 7 }, error: null }),
      organization_execution_targets: () =>
        makeChain({ data: { owner_user_id: USER_A }, error: null })
    });

    const result = await resolveTargetOwnership(supabase, {
      projectId: PROJECT,
      executionTargetId: TARGET
    });
    expect(result).toEqual({ organizationId: 7, ownerUserId: USER_A });
  });
});

describe('canManagePrimary / assertCanManagePrimary', () => {
  function personalTargetSupabase(ownerUserId: string) {
    return makeSupabase({
      projects: () => makeChain({ data: { organization_id: 7 }, error: null }),
      organization_execution_targets: () =>
        makeChain({ data: { owner_user_id: ownerUserId }, error: null })
    });
  }

  function orgOwnedTargetSupabase(memberRows: unknown[]) {
    return makeSupabase({
      projects: () => makeChain({ data: { organization_id: 7 }, error: null }),
      organization_execution_targets: () =>
        makeChain({ data: { owner_user_id: null }, error: null }),
      members: () => makeChain({ data: memberRows, error: null })
    });
  }

  it('allows the owner on a personal target', async () => {
    const supabase = personalTargetSupabase(USER_A);
    await expect(
      canManagePrimary(supabase, { userId: USER_A, projectId: PROJECT, executionTargetId: TARGET })
    ).resolves.toBe(true);
  });

  it('denies a non-owner on a personal target', async () => {
    const supabase = personalTargetSupabase(USER_A);
    await expect(
      canManagePrimary(supabase, { userId: USER_B, projectId: PROJECT, executionTargetId: TARGET })
    ).resolves.toBe(false);
    await expect(
      assertCanManagePrimary(supabase, {
        userId: USER_B,
        projectId: PROJECT,
        executionTargetId: TARGET
      })
    ).rejects.toThrow(/permission/i);
  });

  it('allows a project editor (ADMIN/MANAGER) on an org-owned target', async () => {
    const supabase = orgOwnedTargetSupabase([{ role: 'MANAGER' }]);
    await expect(
      canManagePrimary(supabase, { userId: USER_B, projectId: PROJECT, executionTargetId: TARGET })
    ).resolves.toBe(true);
  });

  it('denies a non-editor on an org-owned target', async () => {
    const supabase = orgOwnedTargetSupabase([]);
    await expect(
      canManagePrimary(supabase, { userId: USER_B, projectId: PROJECT, executionTargetId: TARGET })
    ).resolves.toBe(false);
  });
});

describe('clearTargetPrimary', () => {
  it('clears is_primary scoped to (project, target) only', async () => {
    const chain = makeChain({ data: null, error: null });
    const supabase = makeSupabase({ project_resource_directories: () => chain });

    await clearTargetPrimary(supabase, PROJECT, TARGET);

    expect(chain.update).toHaveBeenCalledWith({ is_primary: false });
    expect(chain.eq).toHaveBeenCalledWith('project_id', PROJECT);
    expect(chain.eq).toHaveBeenCalledWith('execution_target_id', TARGET);
    expect(chain.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
  });
});
