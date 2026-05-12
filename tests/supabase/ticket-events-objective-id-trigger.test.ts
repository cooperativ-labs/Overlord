import { Client } from 'pg';

function getDatabaseUrl() {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  );
}

async function insertTicket(client: Client) {
  const result = await client.query<{ id: string }>(
    `
      insert into public.tickets (organization_id, title)
      values ($1, $2)
      returning id
    `,
    [1, 'Trigger test ticket']
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

describe('ticket_events objective_id trigger', () => {
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

  it('uses the newest executing objective when objective_id is omitted', async () => {
    const ticketId = await insertTicket(client);
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
    const newestExecutingId = await insertObjective(client, {
      ticketId,
      state: 'executing',
      objective: 'newest executing',
      createdAt: '2026-05-12T10:20:00.000Z'
    });

    const eventObjectiveId = await insertTicketEvent(client, { ticketId });

    expect(eventObjectiveId).toBe(newestExecutingId);
  });

  it('falls back to the newest completed objective using completed_at then created_at', async () => {
    const ticketId = await insertTicket(client);
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
    const newestCompletedId = await insertObjective(client, {
      ticketId,
      state: 'complete',
      objective: 'newest complete',
      createdAt: '2026-05-12T10:00:00.000Z',
      completedAt: '2026-05-12T11:30:00.000Z'
    });

    const eventObjectiveId = await insertTicketEvent(client, { ticketId });

    expect(eventObjectiveId).toBe(newestCompletedId);
  });

  it('preserves an explicitly supplied objective_id', async () => {
    const ticketId = await insertTicket(client);
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
