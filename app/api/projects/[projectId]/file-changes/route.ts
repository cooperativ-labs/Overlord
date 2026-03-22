import { NextResponse } from 'next/server';

import { createClient } from '@/supabase/utils/server';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);
    const filePaths = [...new Set(url.searchParams.getAll('filePath').map(value => value.trim()))]
      .filter(Boolean)
      .slice(0, 200);

    const supabase = await createClient();
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

    let excludedTicketIds: string[] = [];
    if (!includeCompleted && project.organization_id) {
      const { data: completeStatuses } = await supabase
        .from('ticket_statuses')
        .select('name')
        .eq('organization_id', project.organization_id)
        .eq('status_type', 'complete');

      const completeStatusNames = (completeStatuses ?? []).map((s: { name: string }) => s.name);

      if (completeStatusNames.length > 0) {
        const { data: completedTickets } = await supabase
          .from('tickets')
          .select('id')
          .eq('project_id', projectId)
          .in('status', completeStatusNames);

        excludedTicketIds = (completedTickets ?? []).map((ticket: { id: string }) => ticket.id);
      }
    }

    let fileChangeQuery = supabase
      .from('file_changes')
      .select(
        'id,file_name,file_path,label,summary,why,impact,change_kind,attribution_source,confidence,hunks,created_at,updated_at,ticket_id,event_id,session_id,tickets!inner(id,title,status,objective,recent_agent,project_id)'
      )
      .eq('tickets.project_id', projectId)
      .order('created_at', { ascending: false });

    if (filePaths.length > 0) {
      fileChangeQuery = fileChangeQuery.in('file_path', filePaths);
    }

    if (excludedTicketIds.length > 0) {
      fileChangeQuery = fileChangeQuery.not('ticket_id', 'in', `(${excludedTicketIds.join(',')})`);
    }

    const { data: fileChanges, error: fileChangeError } = await fileChangeQuery;
    if (fileChangeError) {
      return NextResponse.json({ error: fileChangeError.message }, { status: 500 });
    }

    const eventIds = [...new Set((fileChanges ?? []).map(row => row.event_id))];
    const sessionIds = [...new Set((fileChanges ?? []).map(row => row.session_id))];

    const [eventsResult, sessionsResult] = await Promise.all([
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
        : Promise.resolve({ data: [] as { id: string; agent_identifier: string }[], error: null })
    ]);

    if (eventsResult.error || sessionsResult.error) {
      return NextResponse.json(
        { error: 'Failed to load related event or session data.' },
        { status: 500 }
      );
    }

    const eventsById = new Map((eventsResult.data ?? []).map(event => [event.id, event]));
    const sessionsById = new Map((sessionsResult.data ?? []).map(session => [session.id, session]));

    return NextResponse.json({
      fileChanges: (fileChanges ?? []).map(fileChange => ({
        attribution_source: fileChange.attribution_source,
        change_kind: fileChange.change_kind,
        confidence: fileChange.confidence,
        created_at: fileChange.created_at,
        event: eventsById.get(fileChange.event_id) ?? null,
        file_name: fileChange.file_name,
        file_path: fileChange.file_path,
        hunks: fileChange.hunks,
        id: fileChange.id,
        impact: fileChange.impact,
        label: fileChange.label,
        session: sessionsById.get(fileChange.session_id) ?? null,
        summary: fileChange.summary,
        ticket: fileChange.tickets ?? null,
        updated_at: fileChange.updated_at,
        why: fileChange.why
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
