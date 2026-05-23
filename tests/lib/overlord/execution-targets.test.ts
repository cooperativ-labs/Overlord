import { upsertExecutionTargetFromProtocol } from '@/lib/overlord/execution-targets';

const ORG_ID = 1;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PLACEHOLDER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const FINGERPRINT = 'device-fingerprint-123';

type QueryResult = { data: unknown; error: unknown };

function buildExecutionTargetsQuery(results: QueryResult[]) {
  let callIndex = 0;
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => {
      const result = results[callIndex] ?? { data: null, error: null };
      callIndex += 1;
      return result;
    }),
    then: undefined as unknown
  };

  chain.then = (resolve: (value: QueryResult) => unknown) => {
    const result = results[callIndex] ?? { data: [], error: null };
    callIndex += 1;
    return Promise.resolve(result).then(resolve);
  };

  return chain;
}

function buildSupabase(handlers: Record<string, () => unknown>) {
  return {
    from: jest.fn((table: string) => {
      const handler = handlers[table];
      if (!handler) throw new Error(`unexpected table: ${table}`);
      return handler();
    }),
    rpc: jest.fn(async () => ({ data: 'target-1', error: null }))
  } as any;
}

describe('upsertExecutionTargetFromProtocol', () => {
  it('reconciles SSH placeholders by host and port', async () => {
    const executionTargets = buildExecutionTargetsQuery([
      { data: null, error: null },
      { data: { id: PLACEHOLDER_ID }, error: null }
    ]);
    const update = jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) }));
    executionTargets.update = update;

    const supabase = buildSupabase({
      execution_targets: () => ({
        ...executionTargets,
        update
      }),
      organization_execution_targets: () => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(async () => ({ data: { label: 'ssh-box' }, error: null }))
            }))
          }))
        })),
        upsert: jest.fn(async () => ({ error: null }))
      }),
      user_execution_targets: () => ({
        upsert: jest.fn(async () => ({ error: null }))
      })
    });

    const targetId = await upsertExecutionTargetFromProtocol(supabase, {
      organizationId: ORG_ID,
      userId: USER_ID,
      deviceFingerprint: FINGERPRINT,
      hostname: 'remote.example.com',
      port: 2222,
      platform: 'ssh'
    });

    expect(targetId).toBe(PLACEHOLDER_ID);
    expect(executionTargets.eq).toHaveBeenCalledWith('port', 2222);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        device_fingerprint: FINGERPRINT,
        is_placeholder: false,
        placeholder_key: null
      })
    );
  });

  it('does not reconcile when multiple SSH placeholders share a host without port', async () => {
    const executionTargets = buildExecutionTargetsQuery([
      { data: null, error: null },
      {
        data: [{ id: 'placeholder-22' }, { id: 'placeholder-2222' }],
        error: null
      },
      { data: { id: 'new-target-id' }, error: null }
    ]);
    const insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(async () => ({ data: { id: 'new-target-id' }, error: null }))
      }))
    }));

    const supabase = buildSupabase({
      execution_targets: () => ({
        ...executionTargets,
        insert
      }),
      organization_execution_targets: () => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(async () => ({ data: null, error: null }))
            }))
          }))
        })),
        upsert: jest.fn(async () => ({ error: null }))
      }),
      user_execution_targets: () => ({
        upsert: jest.fn(async () => ({ error: null }))
      })
    });

    const targetId = await upsertExecutionTargetFromProtocol(supabase, {
      organizationId: ORG_ID,
      userId: USER_ID,
      deviceFingerprint: FINGERPRINT,
      hostname: 'remote.example.com',
      platform: 'ssh'
    });

    expect(targetId).toBe('new-target-id');
    expect(insert).toHaveBeenCalled();
    expect(executionTargets.eq).not.toHaveBeenCalledWith('port', expect.anything());
  });
});
