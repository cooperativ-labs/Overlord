import { createExecutionRequest } from '@/lib/overlord/execution-requests';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('execution_requests idempotency', () => {
  let supabase: ReturnType<typeof createServiceRoleClient>;
  let orgId = 0;
  let ticketId = '';
  let objectiveId = '';

  beforeAll(async () => {
    process.env.SUPABASE_URL ??= LOCAL_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= LOCAL_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY ??= LOCAL_SUPABASE_SECRET_KEY;
    supabase = createServiceRoleClient();
    await supabase.auth.admin.createUser({
      user_metadata: {},
      email: 'idempotency-test@test.local',
      email_confirm: true,
      id: USER_ID
    });
  });

  afterAll(async () => {
    await supabase?.auth.admin.deleteUser(USER_ID);
  });

  beforeEach(async () => {
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name: 'Idempotency Test Org' })
      .select('id')
      .single();

    if (orgError) throw orgError;
    orgId = org.id;

    await supabase.rpc('seed_default_ticket_statuses_for_organization', {
      target_organization_id: orgId
    });

    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .insert({
        organization_id: orgId,
        title: 'Idempotency test ticket',
        for_human: false,
        created_by: USER_ID
      })
      .select('id')
      .single();

    if (ticketError) throw ticketError;
    ticketId = ticket.id;

    const { data: objective, error: objectiveError } = await supabase
      .from('objectives')
      .insert({
        ticket_id: ticketId,
        state: 'draft',
        objective: 'Run the idempotency check',
        assigned_agent: { agent: 'codex', model: null, thinking: null }
      })
      .select('id')
      .single();

    if (objectiveError) throw objectiveError;
    objectiveId = objective.id;
  });

  afterEach(async () => {
    if (ticketId) {
      await supabase.from('execution_requests').delete().eq('ticket_id', ticketId);
      await supabase.from('ticket_events').delete().eq('ticket_id', ticketId);
      await supabase.from('objectives').delete().eq('ticket_id', ticketId);
      await supabase.from('tickets').delete().eq('id', ticketId);
    }
    if (orgId) {
      await supabase.from('organizations').delete().eq('id', orgId);
    }
    orgId = 0;
    ticketId = '';
    objectiveId = '';
  });

  it('returns one row when auto_advance is requested twice with the same key', async () => {
    const first = await createExecutionRequest(supabase, {
      ticketId,
      objectiveId,
      userId: USER_ID,
      organizationId: orgId,
      requestedFrom: 'auto_advance'
    });
    const second = await createExecutionRequest(supabase, {
      ticketId,
      objectiveId,
      userId: USER_ID,
      organizationId: orgId,
      requestedFrom: 'auto_advance'
    });

    expect(second.request.id).toBe(first.request.id);

    const { data: rows, error } = await supabase
      .from('execution_requests')
      .select('id, status')
      .eq('organization_id', orgId)
      .eq('idempotency_key', `auto_advance:${objectiveId}`);

    expect(error).toBeNull();
    expect(rows).toHaveLength(1);

    const { data: launched, error: launchError } = await supabase
      .from('execution_requests')
      .update({
        status: 'launched',
        launched_at: new Date().toISOString(),
        lease_expires_at: null
      })
      .eq('id', first.request.id)
      .select('status')
      .single();

    expect(launchError).toBeNull();
    expect(launched?.status).toBe('launched');
  });
});
