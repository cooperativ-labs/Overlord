import { getProjectUserLocalSettingsByProjectId } from '@/lib/actions/projects';

const PROJECT = 'project-1';
const TARGET = 'target-1';

type AnyResult = { data: unknown; error: unknown };

function makeChain(result: AnyResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.then = (resolve: (value: AnyResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain as any;
}

function makeSupabase(primaryRows: unknown[]) {
  return {
    from: jest.fn((table: string) => {
      if (table !== 'project_resource_directories') throw new Error(`unexpected table: ${table}`);
      return makeChain({ data: primaryRows, error: null });
    })
  } as any;
}

describe('getProjectUserLocalSettingsByProjectId (target-scoped reads)', () => {
  it('resolves the (project, target) primary regardless of which user asks', async () => {
    const primaryRows = [
      { project_id: PROJECT, execution_target_id: TARGET, directory_path: '/srv/shared' }
    ];

    const asUserA = await getProjectUserLocalSettingsByProjectId(
      makeSupabase(primaryRows),
      'user-a',
      [PROJECT]
    );
    const asUserB = await getProjectUserLocalSettingsByProjectId(
      makeSupabase(primaryRows),
      'user-b',
      [PROJECT]
    );

    expect(asUserA.get(PROJECT)?.local_working_directory).toBe('/srv/shared');
    // A different user sees the same shared primary directory.
    expect(asUserB.get(PROJECT)?.local_working_directory).toBe('/srv/shared');
  });
});
