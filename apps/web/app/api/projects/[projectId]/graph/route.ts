import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

import { assertOrgMembership } from '@/app/api/projects/_lib';
import { createClientForRequest } from '@/supabase/utils/server';
import type { Json } from '@/types/database.types';

type RouteContext = { params: Promise<{ projectId: string }> };

interface RpcGraphRow {
  id: string;
  file_name: string;
  file_path: string;
  label: string;
  summary: string;
  why: string;
  impact: string;
  change_kind: string;
  attribution_source: string;
  confidence: string;
  hunks: Json;
  created_at: string;
  updated_at: string;
  ticket_id: string;
  event_id: string;
  session_id: string;
  checkpoint_id: string | null;
  objective_id: string | null;
  ticket_data: {
    id: string;
    ticket_id: string;
    title: string;
    status: string;
    project_id: string;
    status_type: string | null;
  } | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);

    const ticketIds = (url.searchParams.get('ticketId') ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(s => UUID_RE.test(s))
      .slice(0, 50);

    const includeCompleted = url.searchParams.get('includeCompleted') === 'true';
    const since = url.searchParams.get('since') ?? undefined;
    const until = url.searchParams.get('until') ?? undefined;
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '5000', 10) || 5000, 1),
      10000
    );

    const supabase = await createClientForRequest();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id,organization_id')
      .eq('id', projectId)
      .maybeSingle();

    if (projectError || !project) {
      return NextResponse.json(
        { error: projectError?.message ?? 'Project not found.' },
        { status: 404 }
      );
    }

    if (!(await assertOrgMembership(supabase, user.id, project.organization_id))) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const { data: rpcRows, error: rpcError } = await supabase.rpc('get_project_graph', {
      p_project_id: projectId,
      p_ticket_ids: ticketIds,
      p_include_completed: includeCompleted,
      p_since: since ?? null,
      p_until: until ?? null,
      p_limit: limit
    });

    if (rpcError) {
      Sentry.captureException(new Error(`Graph RPC failed: ${rpcError.message}`), {
        tags: { feature: 'project-graph', rpcName: 'get_project_graph' },
        extra: { projectId, ticketIdCount: ticketIds.length, code: rpcError.code }
      });
      return NextResponse.json({ error: 'Failed to load graph data.' }, { status: 500 });
    }

    const fileChanges = (rpcRows ?? []) as RpcGraphRow[];

    const eventIds = [...new Set(fileChanges.map(row => row.event_id))];
    const sessionIds = [...new Set(fileChanges.map(row => row.session_id))];
    const checkpointIds = [
      ...new Set(fileChanges.map(row => row.checkpoint_id).filter(Boolean))
    ] as string[];

    const [eventsResult, sessionsResult, checkpointsResult] = await Promise.all([
      eventIds.length
        ? supabase
            .from('ticket_events')
            .select('id,event_type,summary,created_at')
            .in('id', eventIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              event_type: string;
              summary: string | null;
              created_at: string;
            }[],
            error: null
          }),
      sessionIds.length
        ? supabase.from('agent_sessions').select('id,agent_identifier').in('id', sessionIds)
        : Promise.resolve({ data: [] as { id: string; agent_identifier: string }[], error: null }),
      checkpointIds.length
        ? supabase
            .from('project_checkpoints')
            .select(
              'id,checkpoint_kind,git_commit_id,git_ref_name,head_sha,diff_stat,created_at,objective_id'
            )
            .in('id', checkpointIds)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              checkpoint_kind: string;
              git_commit_id: string | null;
              git_ref_name: string | null;
              head_sha: string | null;
              diff_stat: string | null;
              created_at: string;
              objective_id: string | null;
            }>,
            error: null
          })
    ]);

    if (eventsResult.error || sessionsResult.error || checkpointsResult.error) {
      Sentry.captureException(new Error('Graph enrichment queries failed'), {
        tags: { feature: 'project-graph' },
        extra: {
          projectId,
          eventsError: eventsResult.error?.message,
          sessionsError: sessionsResult.error?.message,
          checkpointsError: checkpointsResult.error?.message
        }
      });
      return NextResponse.json(
        { error: 'Failed to load related event, session, or checkpoint data.' },
        { status: 500 }
      );
    }

    const eventsById = new Map((eventsResult.data ?? []).map(e => [e.id, e]));
    const sessionsById = new Map((sessionsResult.data ?? []).map(s => [s.id, s]));
    const checkpointsById = new Map((checkpointsResult.data ?? []).map(c => [c.id, c]));

    const objectiveIds = new Set<string>();
    for (const cp of checkpointsResult.data ?? []) {
      if (cp.objective_id) objectiveIds.add(cp.objective_id);
    }
    for (const fc of fileChanges) {
      if (fc.objective_id) objectiveIds.add(fc.objective_id);
    }

    let objectivesById = new Map<string, { id: string; objective: string | null }>();
    if (objectiveIds.size) {
      const { data: objectiveRows } = await supabase
        .from('objectives')
        .select('id,objective')
        .in('id', [...objectiveIds]);
      objectivesById = new Map(
        (objectiveRows ?? []).map(row => [row.id, { id: row.id, objective: row.objective ?? null }])
      );
    }

    const ticketMap = new Map<string, NonNullable<RpcGraphRow['ticket_data']>>();
    for (const fc of fileChanges) {
      if (fc.ticket_data && !ticketMap.has(fc.ticket_data.id)) {
        ticketMap.set(fc.ticket_data.id, fc.ticket_data);
      }
    }

    return NextResponse.json({
      fileChanges: fileChanges.map(fc => {
        const eventRecord = eventsById.get(fc.event_id) ?? null;
        const checkpointRecord = fc.checkpoint_id
          ? (checkpointsById.get(fc.checkpoint_id) ?? null)
          : null;
        const objectiveId = fc.objective_id ?? checkpointRecord?.objective_id ?? null;

        return {
          id: fc.id,
          file_name: fc.file_name,
          file_path: fc.file_path,
          label: fc.label,
          summary: fc.summary,
          why: fc.why,
          impact: fc.impact,
          change_kind: fc.change_kind,
          attribution_source: fc.attribution_source,
          confidence: fc.confidence,
          hunks: fc.hunks,
          created_at: fc.created_at,
          updated_at: fc.updated_at,
          ticket_id: fc.ticket_id,
          event_id: fc.event_id,
          session_id: fc.session_id,
          checkpoint_id: fc.checkpoint_id,
          objective_id: objectiveId,
          ticket: fc.ticket_data,
          event: eventRecord
            ? {
                id: eventRecord.id,
                event_type: eventRecord.event_type,
                summary: eventRecord.summary,
                created_at: eventRecord.created_at
              }
            : null,
          session: sessionsById.get(fc.session_id) ?? null,
          checkpoint: checkpointRecord
            ? {
                id: checkpointRecord.id,
                checkpoint_kind: checkpointRecord.checkpoint_kind,
                created_at: checkpointRecord.created_at,
                diff_stat: checkpointRecord.diff_stat,
                git_commit_id: checkpointRecord.git_commit_id,
                git_ref_name: checkpointRecord.git_ref_name,
                head_sha: checkpointRecord.head_sha
              }
            : null,
          objective: objectiveId ? (objectivesById.get(objectiveId) ?? null) : null
        };
      }),
      tickets: [...ticketMap.values()]
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'project-graph' } });
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
