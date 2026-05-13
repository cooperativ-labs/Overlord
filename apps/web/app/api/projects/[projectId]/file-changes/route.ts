import { NextResponse } from 'next/server';

import { assertOrgMembership } from '@/app/api/projects/_lib';
import { buildCurrentChangePathVariants } from '@/components/features/projects/current-changes/helpers';
import { createClientForRequest } from '@/supabase/utils/server';
import type { Json } from '@/types/database.types';

type RouteContext = { params: Promise<{ projectId: string }> };

interface RpcFileChangeRow {
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

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);
    const filePaths = [...new Set(url.searchParams.getAll('filePath').map(value => value.trim()))]
      .filter(Boolean)
      .slice(0, 200);
    const roots = [url.searchParams.get('repoRoot'), url.searchParams.get('workingDirectory')]
      .map(value => value?.trim())
      .filter((value): value is string => Boolean(value));
    const filePathVariants = [
      ...new Set(filePaths.flatMap(filePath => buildCurrentChangePathVariants(filePath, roots)))
    ].slice(0, 1000);

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

    const includeCompleted = url.searchParams.get('includeCompleted') === 'true';

    const { data: rpcRows, error: rpcError } = await supabase.rpc('get_project_file_changes', {
      p_project_id: projectId,
      p_file_paths: filePathVariants,
      p_include_completed: includeCompleted
    });

    if (rpcError) {
      console.error('[file-changes] rpc error', {
        projectId,
        filePathCount: filePaths.length,
        filePathVariantCount: filePathVariants.length,
        code: rpcError.code,
        message: rpcError.message
      });
      return NextResponse.json({ error: 'Failed to load file changes.' }, { status: 500 });
    }

    const fileChanges = (rpcRows ?? []) as RpcFileChangeRow[];

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
      return NextResponse.json(
        { error: 'Failed to load related event, session, or checkpoint data.' },
        { status: 500 }
      );
    }

    const ticketIds = [...new Set(fileChanges.map(row => row.ticket_id))];
    const latestObjectiveAgentByTicket = new Map<string, string | null>();

    if (ticketIds.length > 0) {
      const { data: objectives, error: objectivesError } = await supabase
        .from('objectives')
        .select('ticket_id,agent_identifier')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: false });

      if (objectivesError) {
        return NextResponse.json({ error: objectivesError.message }, { status: 500 });
      }

      for (const objective of (objectives ?? []) as Array<{
        ticket_id: string;
        agent_identifier: string | null;
      }>) {
        if (!latestObjectiveAgentByTicket.has(objective.ticket_id)) {
          latestObjectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier ?? null);
        }
      }
    }

    const eventsById = new Map((eventsResult.data ?? []).map(event => [event.id, event]));
    const sessionsById = new Map((sessionsResult.data ?? []).map(session => [session.id, session]));
    const checkpointsById = new Map(
      (checkpointsResult.data ?? []).map(checkpoint => [checkpoint.id, checkpoint])
    );

    const objectiveIds = new Set<string>();
    for (const checkpoint of checkpointsResult.data ?? []) {
      if (checkpoint.objective_id) objectiveIds.add(checkpoint.objective_id);
    }
    for (const fileChange of fileChanges) {
      if (fileChange.objective_id) objectiveIds.add(fileChange.objective_id);
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

    return NextResponse.json({
      fileChanges: fileChanges.map(fileChange => {
        const eventRecord = eventsById.get(fileChange.event_id) ?? null;
        const checkpointRecord = fileChange.checkpoint_id
          ? (checkpointsById.get(fileChange.checkpoint_id) ?? null)
          : null;
        const objectiveId = fileChange.objective_id ?? checkpointRecord?.objective_id ?? null;
        const ticketRow = fileChange.ticket_data;
        return {
          attribution_source: fileChange.attribution_source,
          change_kind: fileChange.change_kind,
          confidence: fileChange.confidence,
          created_at: fileChange.created_at,
          event: eventRecord
            ? {
                id: eventRecord.id,
                event_type: eventRecord.event_type,
                summary: eventRecord.summary,
                created_at: eventRecord.created_at
              }
            : null,
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
          checkpoint_id: fileChange.checkpoint_id,
          objective_id: objectiveId,
          objective: objectiveId ? (objectivesById.get(objectiveId) ?? null) : null,
          file_name: fileChange.file_name,
          file_path: fileChange.file_path,
          hunks: fileChange.hunks,
          id: fileChange.id,
          impact: fileChange.impact,
          label: fileChange.label,
          session: sessionsById.get(fileChange.session_id) ?? null,
          summary: fileChange.summary,
          ticket: ticketRow
            ? {
                ...ticketRow,
                latest_objective_agent:
                  latestObjectiveAgentByTicket.get(fileChange.ticket_id) ?? null
              }
            : null,
          updated_at: fileChange.updated_at,
          why: fileChange.why
        };
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
