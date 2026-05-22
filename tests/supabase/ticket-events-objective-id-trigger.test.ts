import { Client } from 'pg';

function getDatabaseUrl() {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  );
}

async function insertOrganization(client: Client) {
  const result = await client.query<{ id: number }>(
    `insert into public.organizations (name) values ($1) returning id`,
    ['Test Organization']
  );
  const id = result.rows[0].id;
  await client.query(`select public.seed_default_ticket_statuses_for_organization($1)`, [id]);
  return id;
}

async function insertTicket(client: Client, organizationId: number) {
  const result = await client.query<{ id: string }>(
    `
      insert into public.tickets (organization_id, title)
      values ($1, $2)
      returning id
    `,
    [organizationId, 'Trigger test ticket']
  );

  return result.rows[0].id;
}

async function insertObjective(
  client: Client,
  {
    ticketId,
    state,
    objective,
    createdAt,
    completedAt
  }: {
    ticketId: string;
    state: 'executing' | 'complete';
    objective: string;
    createdAt: string;
    completedAt?: string | null;
  }
) {
  const result = await client.query<{ id: string }>(
    `
      insert into public.objectives (ticket_id, state, objective, created_at, completed_at)
      values ($1, $2, $3, $4, $5)
      returning id
    `,
    [ticketId, state, objective, createdAt, completedAt ?? null]
  );

  return result.rows[0].id;
}

async function insertTicketEvent(
  client: Client,
  {
    ticketId,
    objectiveId
  }: {
    ticketId: string;
    objectiveId?: string | null;
  }
) {
  const result = await client.query<{ objective_id: string | null }>(
    `
      insert into public.ticket_events (ticket_id, objective_id, summary)
      values ($1, $2, $3)
      returning objective_id
    `,
    [ticketId, objectiveId ?? null, 'trigger test event']
  );

  return result.rows[0].objective_id;
}

describe('ticket_events objective_id', () => {
  const databaseUrl = getDatabaseUrl();
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query('begin');
  });

  afterEach(async () => {
    await client.query('rollback');
  });

  afterAll(async () => {
    await client.end();
  });

  it('leaves objective_id null when omitted on insert', async () => {
    const orgId = await insertOrganization(client);
    const ticketId = await insertTicket(client, orgId);
    await insertObjective(client, {
      ticketId,
      state: 'executing',
      objective: 'executing objective',
      createdAt: '2026-05-12T10:20:00.000Z'
    });

    const eventObjectiveId = await insertTicketEvent(client, { ticketId });

    expect(eventObjectiveId).toBeNull();
  });

  it('preserves an explicitly supplied objective_id', async () => {
    const orgId = await insertOrganization(client);
    const ticketId = await insertTicket(client, orgId);
    const explicitObjectiveId = await insertObjective(client, {
      ticketId,
      state: 'complete',
      objective: 'explicit objective',
      createdAt: '2026-05-12T10:00:00.000Z',
      completedAt: '2026-05-12T10:15:00.000Z'
    });
    await insertObjective(client, {
      ticketId,
      state: 'executing',
      objective: 'auto objective',
      createdAt: '2026-05-12T10:20:00.000Z'
    });

    const eventObjectiveId = await insertTicketEvent(client, {
      ticketId,
      objectiveId: explicitObjectiveId
    });

    expect(eventObjectiveId).toBe(explicitObjectiveId);
  });
});
