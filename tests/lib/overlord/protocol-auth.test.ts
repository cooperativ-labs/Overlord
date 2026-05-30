jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({ _remoteJwks: true })),
  jwtVerify: jest.fn(async () => {
    throw new Error('invalid jwt');
  })
}));

jest.mock('@/lib/env', () => ({
  getSupabaseUrl: jest.fn(() => 'http://localhost:54321')
}));

jest.mock('@/supabase/utils/service-role', () => ({
  createServiceRoleClient: jest.fn()
}));

import { resolveProtocolAuth } from '@/lib/overlord/protocol-auth';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type Result = { data: unknown; error: unknown };

/**
 * Minimal chainable Supabase mock. `agentToken`/`memberTarget`/`memberDefault`
 * drive the `.maybeSingle()` results for each query in resolveAgentTokenContext.
 */
function makeClient(handlers: {
  agentToken?: Result;
  memberTarget?: Result;
  memberDefault?: Result;
}) {
  function makeBuilder(table: string) {
    const state = { isUpdate: false, eqs: {} as Record<string, unknown> };
    const builder: Record<string, (...args: unknown[]) => unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      update: () => {
        state.isUpdate = true;
        return builder;
      },
      eq: (col: unknown, val: unknown) => {
        state.eqs[String(col)] = val;
        // Fire-and-forget last_used_at update resolves immediately.
        return state.isUpdate ? Promise.resolve({ data: null, error: null }) : builder;
      },
      maybeSingle: () => {
        if (table === 'user_agent_tokens') {
          return Promise.resolve(handlers.agentToken ?? { data: null, error: null });
        }
        if (table === 'members') {
          return Promise.resolve(
            'organization_id' in state.eqs
              ? (handlers.memberTarget ?? { data: null, error: null })
              : (handlers.memberDefault ?? { data: null, error: null })
          );
        }
        return Promise.resolve({ data: null, error: null });
      }
    };
    return builder;
  }

  return { from: (table: string) => makeBuilder(table) };
}

function agentTokenRequest(token: string, headers: Record<string, string> = {}) {
  return new Request('https://www.ovld.ai/api/protocol/attach', {
    headers: { Authorization: `Bearer ${token}`, ...headers }
  });
}

describe('resolveProtocolAuth', () => {
  afterEach(() => {
    delete process.env.OVERLORD_LOCAL_SECRET;
    jest.clearAllMocks();
  });

  it('accepts the hardcoded local dev token on localhost:3000', async () => {
    const result = await resolveProtocolAuth(
      new Request('http://localhost:3000/api/protocol/attach', {
        headers: {
          Authorization: 'Bearer overlord-local-dev-token'
        }
      })
    );

    expect(result.error).toBeNull();
    expect(result.context).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: 1,
      tokenValue: 'overlord-local-dev-token',
      authMethod: 'local_dev_token'
    });
  });

  it('does not accept the local dev token away from localhost:3000', async () => {
    const result = await resolveProtocolAuth(
      new Request('https://www.ovld.ai/api/protocol/attach', {
        headers: {
          Authorization: 'Bearer overlord-local-dev-token'
        }
      })
    );

    expect(result.context).toBeNull();
    expect(result.error?.status).toBe(401);
  });

  it('accepts an oat_ agent token and derives the default organization', async () => {
    (createServiceRoleClient as jest.Mock).mockReturnValue(
      makeClient({
        agentToken: { data: { user_id: 'user-1' }, error: null },
        memberDefault: { data: { organization_id: 7 }, error: null }
      })
    );

    const result = await resolveProtocolAuth(agentTokenRequest('oat_abc123'));

    expect(result.error).toBeNull();
    expect(result.context).toEqual({
      userId: 'user-1',
      organizationId: 7,
      tokenValue: 'oat_abc123',
      authMethod: 'agent_token'
    });
  });

  it('honors an organization hint when the agent token owner is a member', async () => {
    (createServiceRoleClient as jest.Mock).mockReturnValue(
      makeClient({
        agentToken: { data: { user_id: 'user-1' }, error: null },
        memberTarget: { data: { organization_id: 3 }, error: null },
        memberDefault: { data: { organization_id: 7 }, error: null }
      })
    );

    const result = await resolveProtocolAuth(
      agentTokenRequest('oat_abc123', { 'x-organization-id': '3' })
    );

    expect(result.error).toBeNull();
    expect(result.context?.organizationId).toBe(3);
    expect(result.context?.authMethod).toBe('agent_token');
  });

  it('rejects an unknown agent token with 401', async () => {
    (createServiceRoleClient as jest.Mock).mockReturnValue(
      makeClient({ agentToken: { data: null, error: null } })
    );

    const result = await resolveProtocolAuth(agentTokenRequest('oat_unknown'));

    expect(result.context).toBeNull();
    expect(result.error?.status).toBe(401);
  });

  it('rejects an agent token with no organization membership (403)', async () => {
    (createServiceRoleClient as jest.Mock).mockReturnValue(
      makeClient({
        agentToken: { data: { user_id: 'user-1' }, error: null },
        memberDefault: { data: null, error: null }
      })
    );

    const result = await resolveProtocolAuth(agentTokenRequest('oat_abc123'));

    expect(result.context).toBeNull();
    expect(result.error?.status).toBe(403);
  });
});
