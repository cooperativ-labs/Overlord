const mockCreateClientForRequest = jest.fn();
const mockCreateServiceRoleClient = jest.fn();
const mockAssertCanManagePrimary = jest.fn();
const mockClearTargetPrimary = jest.fn();
const mockShouldAutoPrimary = jest.fn();

jest.mock('@/supabase/utils/server', () => ({
  createClientForRequest: (...args: unknown[]) => mockCreateClientForRequest(...args)
}));

jest.mock('@/supabase/utils/service-role', () => ({
  createServiceRoleClient: (...args: unknown[]) => mockCreateServiceRoleClient(...args)
}));

jest.mock('@/lib/resource-directories/primary-resource', () => ({
  assertCanManagePrimary: (...args: unknown[]) => mockAssertCanManagePrimary(...args),
  clearTargetPrimary: (...args: unknown[]) => mockClearTargetPrimary(...args),
  shouldAutoPrimary: (...args: unknown[]) => mockShouldAutoPrimary(...args)
}));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import {
  removeProjectResourceDirectoryAction,
  setResourceDirectoryPrimaryAction
} from '@/lib/actions/resource-directories';

const USER = 'user-1';
const PROJECT = 'project-1';
const TARGET = 'target-1';

/** A service-role client whose `from()` builders pull terminal results from a shared FIFO queue. */
function makeServiceClient(queue: Array<{ data: unknown; error: unknown }>) {
  const builder: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'delete', 'neq']) {
    builder[m] = jest.fn(() => builder);
  }
  const next = () => queue.shift() ?? { data: null, error: null };
  builder.maybeSingle = jest.fn(async () => next());
  builder.single = jest.fn(async () => next());
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(next()).then(resolve);
  return {
    client: { from: jest.fn(() => builder) } as any,
    builder
  };
}

function requestClientWithUser(userId: string | null) {
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) }
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAssertCanManagePrimary.mockResolvedValue(undefined);
  mockClearTargetPrimary.mockResolvedValue(undefined);
});

describe('removeProjectResourceDirectoryAction', () => {
  it('promotes the next directory when the removed row was primary', async () => {
    mockCreateClientForRequest.mockResolvedValue(requestClientWithUser(USER));
    const { client, builder } = makeServiceClient([
      { data: { execution_target_id: TARGET, is_primary: true }, error: null }, // existing
      { data: null, error: null }, // delete
      { data: { id: 'next-dir' }, error: null }, // next candidate
      { data: null, error: null } // promote update
    ]);
    mockCreateServiceRoleClient.mockReturnValue(client);

    await removeProjectResourceDirectoryAction({ directoryId: 'dir-1', projectId: PROJECT });

    expect(mockAssertCanManagePrimary).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ userId: USER, projectId: PROJECT, executionTargetId: TARGET })
    );
    // The promote step set is_primary: true on the next directory.
    expect(builder.update).toHaveBeenCalledWith({ is_primary: true });
    expect(builder.eq).toHaveBeenCalledWith('id', 'next-dir');
  });

  it('does not promote when the removed row was not primary', async () => {
    mockCreateClientForRequest.mockResolvedValue(requestClientWithUser(USER));
    const { client, builder } = makeServiceClient([
      { data: { execution_target_id: TARGET, is_primary: false }, error: null }, // existing
      { data: null, error: null } // delete
    ]);
    mockCreateServiceRoleClient.mockReturnValue(client);

    await removeProjectResourceDirectoryAction({ directoryId: 'dir-1', projectId: PROJECT });

    expect(builder.update).not.toHaveBeenCalledWith({ is_primary: true });
  });

  it('refuses when the caller cannot manage the target', async () => {
    mockCreateClientForRequest.mockResolvedValue(requestClientWithUser(USER));
    const { client } = makeServiceClient([
      { data: { execution_target_id: TARGET, is_primary: true }, error: null }
    ]);
    mockCreateServiceRoleClient.mockReturnValue(client);
    mockAssertCanManagePrimary.mockRejectedValue(new Error('no permission'));

    await expect(
      removeProjectResourceDirectoryAction({ directoryId: 'dir-1', projectId: PROJECT })
    ).rejects.toThrow(/no permission/);
  });
});

describe('setResourceDirectoryPrimaryAction', () => {
  it('clears the prior primary and sets the new one scoped to (project, target)', async () => {
    mockCreateClientForRequest.mockResolvedValue(requestClientWithUser(USER));
    const { client, builder } = makeServiceClient([
      { data: { execution_target_id: TARGET }, error: null }, // existing lookup
      { data: null, error: null } // set is_primary true
    ]);
    mockCreateServiceRoleClient.mockReturnValue(client);

    await setResourceDirectoryPrimaryAction({ directoryId: 'dir-1', projectId: PROJECT });

    expect(mockClearTargetPrimary).toHaveBeenCalledWith(client, PROJECT, TARGET);
    expect(builder.update).toHaveBeenCalledWith({ is_primary: true });
    expect(builder.eq).toHaveBeenCalledWith('id', 'dir-1');
    // No user_id scoping on the write.
    expect(builder.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
  });
});
