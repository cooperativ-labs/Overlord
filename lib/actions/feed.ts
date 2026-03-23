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

export async function getFeedPostsAction(options?: {
  projectId?: string;
  daysBack?: number;
}): Promise<FeedPost[]> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const daysBack = options?.daysBack ?? 3;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  let query = supabase
    .from('feed_posts')
    .select(
      `
      *,
      projects!inner(name, color),
      tickets!inner(title, objective, ticket_sequence)
    `
    )
    .gte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: false })
    .limit(100);

  if (options?.projectId) {
    query = query.eq('project_id', options.projectId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getFeedPostsAction] error:', error);
    Sentry.captureException(error);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const projects = row.projects as { name: string; color: string } | null;
    const tickets = row.tickets as {
      title: string | null;
      objective: string | null;
      ticket_sequence: number | null;
    } | null;

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
      files_touched: row.files_touched as string[],
      tradeoffs: row.tradeoffs as FeedPost['tradeoffs'],
      human_actions: (row.human_actions as string[]) ?? [],
      source_event_ids: row.source_event_ids as string[],
      source_window_start: row.source_window_start as string | null,
      source_window_end: row.source_window_end as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      project_name: projects?.name ?? 'Unknown',
      project_color: projects?.color ?? '#6b7280',
      ticket_title: tickets?.title ?? null,
      ticket_objective: tickets?.objective ?? null,
      ticket_sequence: tickets?.ticket_sequence ?? null
    };
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
