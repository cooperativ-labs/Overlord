import { NextResponse } from 'next/server';

import { assertOrgMembership, chunkUuidListForPostgrestNotIn } from '@/app/api/projects/_lib';
import { createClientForRequest } from '@/supabase/utils/server';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);
    const filePaths = [...new Set(url.searchParams.getAll('filePath').map(value => value.trim()))]
      .filter(Boolean)
      .slice(0, 200);

    const supabase = await createClientForRequest();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const includeCompleted = url.searchParams.get('includeCompleted') === 'true';

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

    let excludedTicketIds: string[] = [];
    if (!includeCompleted && project.organization_id) {
      const { data: terminalStatuses } = await supabase
        .from('ticket_statuses')
        .select('name')
        .eq('organization_id', project.organization_id)
        .or('status_type.eq.complete,name.ilike.cancelled');

      const terminalStatusNames = [
        ...new Set((terminalStatuses ?? []).map((s: { name: string }) => s.name))
      ];

      if (terminalStatusNames.length > 0) {
        const { data: excludedTickets } = await supabase
          .from('tickets')
          .select('id')
          .eq('project_id', projectId)
          .in('status', terminalStatusNames);

        excludedTicketIds = (excludedTickets ?? []).map((ticket: { id: string }) => ticket.id);
      }
    }

    let fileChangeQuery = supabase
      .from('file_changes')
      .select(
        'id,file_name,file_path,label,summary,why,impact,change_kind,attribution_source,confidence,hunks,created_at,updated_at,ticket_id,event_id,session_id,checkpoint_id,snapshot_backend,workspace_name,workspace_path,jj_change_id,jj_commit_id,jj_operation_id,tickets!inner(id,ticket_id,title,status,project_id)'
      )
      .eq('tickets.project_id', projectId)
      .order('created_at', { ascending: false });

    if (filePaths.length > 0) {
      fileChangeQuery = fileChangeQuery.in('file_path', filePaths);
    }

    for (const chunk of chunkUuidListForPostgrestNotIn(excludedTicketIds)) {
      fileChangeQuery = fileChangeQuery.not('ticket_id', 'in', `(${chunk.join(',')})`);
    }

    const { data: fileChanges, error: fileChangeError } = await fileChangeQuery;
    if (fileChangeError) {
      return NextResponse.json({ error: fileChangeError.message }, { status: 500 });
    }

    const eventIds = [...new Set((fileChanges ?? []).map(row => row.event_id))];
    const sessionIds = [...new Set((fileChanges ?? []).map(row => row.session_id))];
    const checkpointIds = [
      ...new Set((fileChanges ?? []).map(row => row.checkpoint_id).filter(Boolean))
    ];

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
              'id,checkpoint_kind,backend,workspace_name,workspace_path,jj_change_id,jj_commit_id,jj_operation_id,git_commit_id,diff_stat,created_at'
            )
            .in('id', checkpointIds as string[])
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              checkpoint_kind: string;
              backend: string;
              workspace_name: string | null;
              workspace_path: string | null;
              jj_change_id: string | null;
              jj_commit_id: string | null;
              jj_operation_id: string | null;
              git_commit_id: string | null;
              diff_stat: string | null;
              created_at: string;
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

    const ticketIds = [...new Set((fileChanges ?? []).map(row => row.ticket_id))];
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

    return NextResponse.json({
      fileChanges: [
        ...(fileChanges ?? []).map(fileChange => ({
          attribution_source: fileChange.attribution_source,
          change_kind: fileChange.change_kind,
          confidence: fileChange.confidence,
          created_at: fileChange.created_at,
          event: eventsById.get(fileChange.event_id) ?? null,
          checkpoint: fileChange.checkpoint_id
            ? (checkpointsById.get(fileChange.checkpoint_id) ?? null)
            : null,
          checkpoint_id: fileChange.checkpoint_id,
          file_name: fileChange.file_name,
          file_path: fileChange.file_path,
          hunks: fileChange.hunks,
          id: fileChange.id,
          impact: fileChange.impact,
          label: fileChange.label,
          jj_change_id: fileChange.jj_change_id,
          jj_commit_id: fileChange.jj_commit_id,
          jj_operation_id: fileChange.jj_operation_id,
          snapshot_backend: fileChange.snapshot_backend,
          session: sessionsById.get(fileChange.session_id) ?? null,
          summary: fileChange.summary,
          ticket: fileChange.tickets
            ? {
                ...fileChange.tickets,
                latest_objective_agent:
                  latestObjectiveAgentByTicket.get(fileChange.ticket_id) ?? null
              }
            : null,
          workspace_name: fileChange.workspace_name,
          workspace_path: fileChange.workspace_path,
          updated_at: fileChange.updated_at,
          why: fileChange.why
        }))
      ]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
