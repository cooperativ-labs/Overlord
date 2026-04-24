import { getSupabase } from './supabase';
import type { FeedPost } from './types';

export type FeedPostRow = {
  id: string;
  organization_id: number;
  project_id: string;
  ticket_id: string;
  session_id: string | null;
  objective_id: string | null;
  agent_type: string | null;
  title: string;
  body: string;
  tags: string[] | null;
  impact_level: string | null;
  files_touched: string[] | null;
  tradeoffs: FeedPost['tradeoffs'] | null;
  human_actions: string[] | null;
  tickets_created: FeedPost['tickets_created'] | null;
  source_event_ids: string[] | null;
  source_window_start: string | null;
  source_window_end: string | null;
  created_at: string;
  updated_at: string;
  projects?: { name: string; color: string } | { name: string; color: string }[] | null;
  tickets?:
    | { title: string | null; ticket_sequence: number | null }
    | { title: string | null; ticket_sequence: number | null }[]
    | null;
};

export type FeedPostInsertRow = {
  id: string;
  organization_id: number;
  project_id: string;
  ticket_id: string;
  session_id: string | null;
  objective_id: string | null;
  agent_type: string | null;
  title: string;
  body: string;
  tags: string[] | null;
  impact_level: string | null;
  files_touched: string[] | null;
  tradeoffs: FeedPost['tradeoffs'] | null;
  human_actions: string[] | null;
  tickets_created: FeedPost['tickets_created'] | null;
  source_event_ids: string[] | null;
  source_window_start: string | null;
  source_window_end: string | null;
  created_at: string;
  updated_at: string;
};

export const FEED_POST_SELECT =
  'id, organization_id, project_id, ticket_id, session_id, objective_id, agent_type, title, body, tags, impact_level, files_touched, tradeoffs, human_actions, tickets_created, source_event_ids, source_window_start, source_window_end, created_at, updated_at, projects!inner(name, color), tickets!inner(title, ticket_sequence)';

function normalizeTradeoffs(value: unknown): FeedPost['tradeoffs'] {
  return Array.isArray(value)
    ? value
        .map(tradeoff => {
          if (!tradeoff || typeof tradeoff !== 'object') return null;
          const row = tradeoff as Record<string, unknown>;
          return {
            decision: typeof row.decision === 'string' ? row.decision : '',
            alternatives_considered:
              typeof row.alternatives_considered === 'string' ? row.alternatives_considered : '',
            rationale: typeof row.rationale === 'string' ? row.rationale : ''
          };
        })
        .filter(
          (tradeoff): tradeoff is FeedPost['tradeoffs'][number] =>
            tradeoff !== null && tradeoff.decision.length > 0
        )
    : [];
}

function normalizeTicketsCreated(value: unknown): FeedPost['tickets_created'] {
  return Array.isArray(value)
    ? value
        .map(ticket => {
          if (!ticket || typeof ticket !== 'object') return null;
          const row = ticket as Record<string, unknown>;
          const id = typeof row.id === 'string' ? row.id : '';
          const title = typeof row.title === 'string' ? row.title : '';
          const sequence = typeof row.sequence === 'number' ? row.sequence : null;
          if (!id || !title || sequence === null) return null;
          return { id, sequence, title };
        })
        .filter((ticket): ticket is FeedPost['tickets_created'][number] => ticket !== null)
    : [];
}

export function normalizeFeedPostRow(row: FeedPostRow): FeedPost {
  const project = Array.isArray(row.projects) ? (row.projects[0] ?? null) : (row.projects ?? null);
  const ticket = Array.isArray(row.tickets) ? (row.tickets[0] ?? null) : (row.tickets ?? null);

  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    body: row.body,
    impact_level: row.impact_level ?? 'notable',
    agent_type: row.agent_type,
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
    files_touched: Array.isArray(row.files_touched) ? row.files_touched.filter(Boolean) : [],
    human_actions: Array.isArray(row.human_actions) ? row.human_actions.filter(Boolean) : [],
    tradeoffs: normalizeTradeoffs(row.tradeoffs),
    tickets_created: normalizeTicketsCreated(row.tickets_created),
    ticket_title: ticket?.title ?? null,
    ticket_sequence: ticket?.ticket_sequence ?? null,
    project_name: project?.name ?? 'Unknown',
    project_color: project?.color ?? '#6b7280',
    ticket_id: row.ticket_id,
    created_at: row.created_at
  };
}

export async function loadFeedPosts(projectId: string | null): Promise<FeedPost[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('feed_posts')
    .select(FEED_POST_SELECT)
    .order('created_at', { ascending: false })
    .limit(50);

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as FeedPostRow[]).map(normalizeFeedPostRow);
}

export async function enrichFeedPost(row: FeedPostInsertRow): Promise<FeedPost> {
  const supabase = getSupabase();

  const [projectResult, ticketResult] = await Promise.all([
    supabase.from('projects').select('name, color').eq('id', row.project_id).maybeSingle(),
    supabase.from('tickets').select('title, ticket_sequence').eq('id', row.ticket_id).maybeSingle()
  ]);

  return normalizeFeedPostRow({
    ...row,
    projects: projectResult.data ?? null,
    tickets: ticketResult.data ?? null
  });
}
