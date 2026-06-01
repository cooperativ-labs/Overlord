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
    ['Ticket search test org']
  );
  const id = result.rows[0].id;
  await client.query(`select public.seed_default_ticket_statuses_for_organization($1)`, [id]);
  return id;
}

async function insertTicket(
  client: Client,
  {
    organizationId,
    title,
    updatedAt
  }: {
    organizationId: number;
    title: string;
    updatedAt: string;
  }
) {
  const result = await client.query<{ id: string; ticket_id: string }>(
    `
      insert into public.tickets (organization_id, title, updated_at)
      values ($1, $2, $3)
      returning id, ticket_id
    `,
    [organizationId, title, updatedAt]
  );

  return result.rows[0];
}

async function insertObjective(
  client: Client,
  {
    ticketId,
    objective,
    createdAt
  }: {
    ticketId: string;
    objective: string;
    createdAt: string;
  }
) {
  await client.query(
    `
      insert into public.objectives (ticket_id, state, objective, created_at)
      values ($1, 'draft', $2, $3)
    `,
    [ticketId, objective, createdAt]
  );
}

type SearchRow = {
  id: string;
  title: string;
  ticket_id: string;
};

async function searchTickets(
  client: Client,
  {
    organizationId,
    query,
    exactTicketId,
    limit = 8
  }: {
    organizationId: number;
    query: string;
    exactTicketId?: string | null;
    limit?: number;
  }
) {
  const result = await client.query<SearchRow>(
    `
      select id, title, ticket_id
      from public.search_tickets(
        p_query => $1,
        p_exact_ticket_id => $2,
        p_organization_id => $3,
        p_limit => $4
      )
    `,
    [query, exactTicketId ?? null, organizationId, limit]
  );

  return result.rows;
}

describe('search_tickets RPC', () => {
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

  it('ranks an older title match above a newer objective-only match', async () => {
    const organizationId = await insertOrganization(client);
    const titleTicket = await insertTicket(client, {
      organizationId,
      title: 'Fix authentication regression',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });
    const objectiveTicket = await insertTicket(client, {
      organizationId,
      title: 'Unrelated newer ticket',
      updatedAt: '2026-06-01T10:00:00.000Z'
    });

    await insertObjective(client, {
      ticketId: objectiveTicket.id,
      objective: 'Investigate authentication rollout details',
      createdAt: '2026-06-01T09:00:00.000Z'
    });

    const results = await searchTickets(client, {
      organizationId,
      query: 'authentication'
    });

    expect(results[0]?.id).toBe(titleTicket.id);
    expect(results.map(row => row.id)).toEqual(
      expect.arrayContaining([titleTicket.id, objectiveTicket.id])
    );
  });

  it('returns an exact ticket_id match first', async () => {
    const organizationId = await insertOrganization(client);
    const target = await insertTicket(client, {
      organizationId,
      title: 'Target ticket',
      updatedAt: '2026-06-01T10:00:00.000Z'
    });
    await insertTicket(client, {
      organizationId,
      title: 'Other ticket',
      updatedAt: '2026-06-01T11:00:00.000Z'
    });

    const results = await searchTickets(client, {
      organizationId,
      query: '1 1150',
      exactTicketId: target.ticket_id
    });

    expect(results[0]?.ticket_id).toBe(target.ticket_id);
  });
});
