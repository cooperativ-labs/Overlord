const mockCreateClientForRequest = jest.fn();
const mockCreateServiceRoleClient = jest.fn();

jest.mock('@/supabase/utils/server', () => ({
  createClientForRequest: (...args: unknown[]) => mockCreateClientForRequest(...args)
}));
jest.mock('@/supabase/utils/service-role', () => ({
  createServiceRoleClient: (...args: unknown[]) => mockCreateServiceRoleClient(...args)
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { setExecutionTargetOwnershipAction } from '@/lib/actions/resource-directories';

const ADMIN = 'admin-user';
const OWNER = 'owner-user';
const OTHER = 'other-user';
const TARGET = 'target-1';
const ORG = 42;

function requestClientWithUser(userId: string) {
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: userId } } })) }
  } as any;
}

/**
 * Service client returning: oet existing row, then admin-role lookup, then the
 * update result, in FIFO order across `from()` builders.
 */
function makeServiceClient(queue: Array<{ data: unknown; error: unknown }>) {
  const builder: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'delete']) {
    builder[m] = jest.fn(() => builder);
  }
  const next = () => queue.shift() ?? { data: null, error: null };
  builder.maybeSingle = jest.fn(async () => next());
  builder.single = jest.fn(async () => next());
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(next()).then(resolve);
  return { client: { from: jest.fn(() => builder) } as any, builder };
}

beforeEach(() => jest.clearAllMocks());

describe('setExecutionTargetOwnershipAction', () => {
  it('lets an org admin donate a target to the org (owner -> null)', async () => {
    mockCreateClientForRequest.mockResolvedValue(requestClientWithUser(ADMIN));
    const { client, builder } = makeServiceClient([
      { data: { owner_user_id: OWNER }, error: null }, // existing oet
      { data: [{ role: 'ADMIN' }], error: null }, // admin lookup
      { data: null, error: null } // update
    ]);
    mockCreateServiceRoleClient.mockReturnValue(client);

    await setExecutionTargetOwnershipAction({
      targetId: TARGET,
      organizationId: ORG,
      ownerUserId: null
    });

    expect(builder.update).toHaveBeenCalledWith({ owner_user_id: null });
  });

  it('lets the current owner transfer ownership', async () => {
    mockCreateClientForRequest.mockResolvedValue(requestClientWithUser(OWNER));
    const { client, builder } = makeServiceClient([
      { data: { owner_user_id: OWNER }, error: null }, // existing oet
      { data: [], error: null }, // admin lookup (not admin)
      { data: null, error: null } // update
    ]);
    mockCreateServiceRoleClient.mockReturnValue(client);

    await setExecutionTargetOwnershipAction({
      targetId: TARGET,
      organizationId: ORG,
      ownerUserId: OTHER
    });

    expect(builder.update).toHaveBeenCalledWith({ owner_user_id: OTHER });
  });

  it('rejects a non-admin, non-owner', async () => {
    mockCreateClientForRequest.mockResolvedValue(requestClientWithUser(OTHER));
    const { client } = makeServiceClient([
      { data: { owner_user_id: OWNER }, error: null }, // existing oet
      { data: [], error: null } // admin lookup (not admin)
    ]);
    mockCreateServiceRoleClient.mockReturnValue(client);

    await expect(
      setExecutionTargetOwnershipAction({
        targetId: TARGET,
        organizationId: ORG,
        ownerUserId: OTHER
      })
    ).rejects.toThrow(/admin or the current owner/i);
  });
});
