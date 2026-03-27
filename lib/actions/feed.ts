'use server';

import * as Sentry from '@sentry/nextjs';

import { createClient } from '@/supabase/utils/server';

export type FeedPost = {
  id: string;
  organization_id: number;
  project_id: string;
  ticket_id: string;
  session_id: string | null;
  agent_type: string | null;
  title: string;
  body: string;
  tags: string[];
  impact_level: string;
  files_touched: string[];
  tradeoffs: Array<{ decision: string; alternatives_considered: string; rationale: string }>;
  human_actions: string[];
  tickets_created: Array<{ id: string; sequence: number; title: string }>;
  source_event_ids: string[];
  source_window_start: string | null;
  source_window_end: string | null;
  created_at: string;
  updated_at: string;
  project_name: string;
  project_color: string;
  ticket_title: string | null;
  ticket_objective: string | null;
  ticket_sequence: number | null;
};

export type ExecutingFeedTicket = {
  id: string;
  project_id: string;
  title: string | null;
  ticket_sequence: number | null;
  project_name: string;
  project_color: string;
  running_agent: string;
  attached_at: string | null;
};

export async function getFeedPostsAction(options?: {
  projectId?: string;
  daysBack?: number;
  limit?: number;
  offset?: number;
}): Promise<FeedPost[]> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  let query = supabase
    .from('feed_posts')
    .select(
      `
      *,
      projects!inner(name, color),
      tickets!inner(title, ticket_sequence)
    `
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options?.daysBack !== undefined) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - options.daysBack);
    query = query.gte('created_at', cutoff.toISOString());
  }

  if (options?.projectId) {
    query = query.eq('project_id', options.projectId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getFeedPostsAction] error:', error);
    Sentry.captureException(error);
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const ticketIds = [...new Set(rows.map(row => row.ticket_id).filter(Boolean) as string[])];
  const latestObjectiveByTicketId = new Map<string, string>();

  const filePathsByTicketId = new Map<string, string[]>();

  if (ticketIds.length > 0) {
    const [
      { data: objectives, error: objectivesError },
      { data: fileChanges, error: fileChangesError }
    ] = await Promise.all([
      supabase
        .from('objectives')
        .select('ticket_id,objective,created_at')
        .in('ticket_id', ticketIds)
        .eq('is_executed', false)
        .order('created_at', { ascending: false }),
      supabase
        .from('file_changes')
        .select('ticket_id,file_path')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: false })
    ]);

    if (objectivesError) {
      console.error('[getFeedPostsAction] objectives error:', objectivesError);
      Sentry.captureException(objectivesError);
    } else {
      for (const row of (objectives ?? []) as Array<{
        ticket_id: string;
        objective: string;
      }>) {
        if (!latestObjectiveByTicketId.has(row.ticket_id) && row.objective.trim()) {
          latestObjectiveByTicketId.set(row.ticket_id, row.objective);
        }
      }
    }

    if (fileChangesError) {
      console.error('[getFeedPostsAction] file_changes error:', fileChangesError);
      Sentry.captureException(fileChangesError);
    } else {
      for (const row of fileChanges ?? []) {
        const ticketId = row.ticket_id;
        const filePath = row.file_path?.trim();
        if (!ticketId || !filePath) continue;

        const existing = filePathsByTicketId.get(ticketId) ?? [];
        if (!existing.includes(filePath)) {
          existing.push(filePath);
          filePathsByTicketId.set(ticketId, existing);
        }
      }
    }
  }

  return rows.map((row: Record<string, unknown>) => {
    const projects = row.projects as { name: string; color: string } | null;
    const tickets = row.tickets as {
      title: string | null;
      ticket_sequence: number | null;
    } | null;
    const storedFilesTouched = Array.isArray(row.files_touched)
      ? (row.files_touched as string[]).filter(Boolean)
      : [];
    const changedFiles = filePathsByTicketId.get(row.ticket_id as string) ?? [];

    return {
      id: row.id as string,
      organization_id: row.organization_id as number,
      project_id: row.project_id as string,
      ticket_id: row.ticket_id as string,
      session_id: row.session_id as string | null,
      agent_type: row.agent_type as string | null,
      title: row.title as string,
      body: row.body as string,
      tags: row.tags as string[],
      impact_level: row.impact_level as string,
      files_touched: changedFiles.length > 0 ? changedFiles : storedFilesTouched,
      tradeoffs: row.tradeoffs as FeedPost['tradeoffs'],
      human_actions: (row.human_actions as string[]) ?? [],
      tickets_created: (row.tickets_created as FeedPost['tickets_created']) ?? [],
      source_event_ids: row.source_event_ids as string[],
      source_window_start: row.source_window_start as string | null,
      source_window_end: row.source_window_end as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      project_name: projects?.name ?? 'Unknown',
      project_color: projects?.color ?? '#6b7280',
      ticket_title: tickets?.title ?? null,
      ticket_objective: latestObjectiveByTicketId.get(row.ticket_id as string) ?? null,
      ticket_sequence: tickets?.ticket_sequence ?? null
    };
  });
}

export async function getExecutingFeedTicketsAction(): Promise<ExecutingFeedTicket[]> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: executeStatuses, error: executeStatusesError } = await supabase
    .from('ticket_statuses')
    .select('organization_id,name')
    .eq('status_type', 'execute');

  if (executeStatusesError) {
    console.error('[getExecutingFeedTicketsAction] execute statuses error:', executeStatusesError);
    Sentry.captureException(executeStatusesError);
    throw new Error(executeStatusesError.message);
  }

  const ticketResults = await Promise.all(
    (executeStatuses ?? []).map(status =>
      supabase
        .from('tickets')
        .select(
          `
          id,
          organization_id,
          project_id,
          title,
          ticket_sequence,
          updated_at,
          projects!inner(name, color)
        `
        )
        .eq('organization_id', status.organization_id)
        .eq('status', status.name)
        .order('updated_at', { ascending: false })
        .limit(24)
    )
  );

  for (const result of ticketResults) {
    if (result.error) {
      console.error('[getExecutingFeedTicketsAction] tickets error:', result.error);
      Sentry.captureException(result.error);
      throw new Error(result.error.message);
    }
  }

  const rows = ticketResults
    .flatMap(result => result.data ?? [])
    .sort((a, b) => {
      const left = new Date((a as { updated_at: string }).updated_at).getTime();
      const right = new Date((b as { updated_at: string }).updated_at).getTime();
      return right - left;
    })
    .slice(0, 24) as Array<
    Record<string, unknown> & {
      id: string;
      organization_id: number;
      project_id: string;
      title: string | null;
      ticket_sequence: number | null;
    }
  >;
  const ticketIds = rows.map(ticket => ticket.id);

  if (ticketIds.length === 0) return [];

  const { data: sessions, error: sessionsError } = await supabase
    .from('agent_sessions')
    .select('ticket_id,session_state,agent_identifier,attached_at')
    .in('ticket_id', ticketIds)
    .order('attached_at', { ascending: false });

  if (sessionsError) {
    console.error('[getExecutingFeedTicketsAction] agent_sessions error:', sessionsError);
    Sentry.captureException(sessionsError);
    throw new Error(sessionsError.message);
  }

  const latestAttachedSessionByTicketId = new Map<
    string,
    { agent_identifier: string; attached_at: string | null }
  >();

  for (const session of (sessions ?? []) as Array<{
    ticket_id: string;
    session_state: string;
    agent_identifier: string;
    attached_at: string | null;
  }>) {
    if (latestAttachedSessionByTicketId.has(session.ticket_id)) continue;
    if (session.session_state !== 'attached') continue;

    latestAttachedSessionByTicketId.set(session.ticket_id, {
      agent_identifier: session.agent_identifier,
      attached_at: session.attached_at
    });
  }

  return rows
    .map(ticket => {
      const project = ticket.projects as { name: string; color: string } | null;
      const session = latestAttachedSessionByTicketId.get(ticket.id);
      if (!session?.agent_identifier) return null;

      return {
        id: ticket.id,
        project_id: ticket.project_id,
        title: ticket.title,
        ticket_sequence: ticket.ticket_sequence,
        project_name: project?.name ?? 'Unknown',
        project_color: project?.color ?? '#6b7280',
        running_agent: session.agent_identifier,
        attached_at: session.attached_at
      };
    })
    .filter((ticket): ticket is ExecutingFeedTicket => ticket !== null)
    .sort((a, b) => {
      if (!a.attached_at && !b.attached_at) return 0;
      if (!a.attached_at) return 1;
      if (!b.attached_at) return -1;
      return new Date(b.attached_at).getTime() - new Date(a.attached_at).getTime();
    });
}

export async function getFeedRetentionDaysAction(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Get the first org the user belongs to (most users have one org)
  const { data: membership } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!membership) return 30;

  const { data: org } = await supabase
    .from('organizations')
    .select('feed_retention_days')
    .eq('id', membership.organization_id)
    .single();

  return org?.feed_retention_days ?? 30;
}

export async function updateFeedRetentionDaysAction(days: number): Promise<number> {
  if (days < 1 || days > 365) throw new Error('Retention must be between 1 and 365 days.');

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: membership } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!membership) throw new Error('No organization found.');

  const { data, error } = await supabase
    .from('organizations')
    .update({ feed_retention_days: days })
    .eq('id', membership.organization_id)
    .select('feed_retention_days')
    .single();

  if (error) throw new Error(error.message);
  return data?.feed_retention_days ?? days;
}
