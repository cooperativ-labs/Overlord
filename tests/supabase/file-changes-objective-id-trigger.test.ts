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
    [organizationId, 'File change trigger test ticket']
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

async function insertSession(client: Client, objectiveId: string) {
  const result = await client.query<{ id: string }>(
    `
      insert into public.agent_sessions (objective_id, agent_identifier)
      values ($1, $2)
      returning id
    `,
    [objectiveId, 'codex']
  );

  return result.rows[0].id;
}

async function insertTicketEvent(
  client: Client,
  { ticketId, objectiveId }: { ticketId: string; objectiveId?: string | null }
) {
  const result = await client.query<{ id: string }>(
    `
      insert into public.ticket_events (ticket_id, objective_id, summary)
      values ($1, $2, $3)
      returning id
    `,
    [ticketId, objectiveId ?? null, 'file change trigger parent event']
  );

  return result.rows[0].id;
}

async function insertFileChange(
  client: Client,
  {
    ticketId,
    sessionId,
    eventId,
    objectiveId
  }: {
    ticketId: string;
    sessionId?: string | null;
    eventId: string;
    objectiveId?: string | null;
  }
) {
  const result = await client.query<{ objective_id: string | null }>(
    `
      insert into public.file_changes (
        ticket_id,
        session_id,
        event_id,
        objective_id,
        file_name,
        file_path,
        label,
        summary,
        why,
        impact
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning objective_id
    `,
    [
      ticketId,
      sessionId ?? null,
      eventId,
      objectiveId ?? null,
      'example.ts',
      'src/example.ts',
      'Update example',
      'Updated the example implementation.',
      'Needed to support objective auto-association.',
      'File changes now link to objectives.'
    ]
  );

  return result.rows[0].objective_id;
}

describe('file_changes objective_id trigger', () => {
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

  it('uses the session objective when objective_id is omitted', async () => {
    const orgId = await insertOrganization(client);
    const ticketId = await insertTicket(client, orgId);
    await insertObjective(client, {
      ticketId,
      state: 'complete',
      objective: 'completed first',
      createdAt: '2026-05-12T10:00:00.000Z',
      completedAt: '2026-05-12T10:05:00.000Z'
    });
    await insertObjective(client, {
      ticketId,
      state: 'executing',
      objective: 'older executing',
      createdAt: '2026-05-12T10:10:00.000Z'
    });
    const sessionObjectiveId = await insertObjective(client, {
      ticketId,
      state: 'executing',
      objective: 'session objective',
      createdAt: '2026-05-12T10:20:00.000Z'
    });
    const sessionId = await insertSession(client, sessionObjectiveId);
    const eventId = await insertTicketEvent(client, { ticketId, objectiveId: sessionObjectiveId });

    const fileChangeObjectiveId = await insertFileChange(client, {
      ticketId,
      sessionId,
      eventId
    });

    expect(fileChangeObjectiveId).toBe(sessionObjectiveId);
  });

  it('uses the session objective over other ticket objectives when objective_id is omitted', async () => {
    const orgId = await insertOrganization(client);
    const ticketId = await insertTicket(client, orgId);
    await insertObjective(client, {
      ticketId,
      state: 'complete',
      objective: 'older complete',
      createdAt: '2026-05-12T09:00:00.000Z',
      completedAt: '2026-05-12T09:30:00.000Z'
    });
    await insertObjective(client, {
      ticketId,
      state: 'complete',
      objective: 'null completed_at',
      createdAt: '2026-05-12T11:00:00.000Z',
      completedAt: null
    });
    const sessionObjectiveId = await insertObjective(client, {
      ticketId,
      state: 'complete',
      objective: 'session objective',
      createdAt: '2026-05-12T10:00:00.000Z',
      completedAt: '2026-05-12T11:30:00.000Z'
    });
    await insertObjective(client, {
      ticketId,
      state: 'executing',
      objective: 'newer executing on ticket',
      createdAt: '2026-05-12T12:00:00.000Z'
    });
    const sessionId = await insertSession(client, sessionObjectiveId);
    const eventId = await insertTicketEvent(client, { ticketId, objectiveId: sessionObjectiveId });

    const fileChangeObjectiveId = await insertFileChange(client, {
      ticketId,
      sessionId,
      eventId
    });

    expect(fileChangeObjectiveId).toBe(sessionObjectiveId);
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
    const sessionId = await insertSession(client, explicitObjectiveId);
    const eventId = await insertTicketEvent(client, { ticketId, objectiveId: explicitObjectiveId });

    const fileChangeObjectiveId = await insertFileChange(client, {
      ticketId,
      sessionId,
      eventId,
      objectiveId: explicitObjectiveId
    });

    expect(fileChangeObjectiveId).toBe(explicitObjectiveId);
  });
});
