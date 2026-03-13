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

    // When not including completed tickets, resolve which ticket IDs to exclude
    // by looking up status names with status_type = 'complete' for this org.
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

        excludedTicketIds = (completedTickets ?? []).map((t: { id: string }) => t.id);
      }
    }

    let rationaleQuery = supabase
      .from('change_rationales')
      .select(
        'id,file_path,label,summary,why,impact,change_kind,attribution_source,confidence,hunks,created_at,updated_at,ticket_id,event_id,session_id'
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (filePaths.length > 0) {
      rationaleQuery = rationaleQuery.in('file_path', filePaths);
    }

    if (excludedTicketIds.length > 0) {
      // PostgREST `not.in` filter: exclude rationales from completed tickets
      rationaleQuery = rationaleQuery.not('ticket_id', 'in', `(${excludedTicketIds.join(',')})`);
    }

    const { data: rationales, error: rationaleError } = await rationaleQuery;
    if (rationaleError) {
      return NextResponse.json({ error: rationaleError.message }, { status: 500 });
    }

    const ticketIds = [...new Set((rationales ?? []).map(row => row.ticket_id))];
    const eventIds = [...new Set((rationales ?? []).map(row => row.event_id))];
    const sessionIds = [...new Set((rationales ?? []).map(row => row.session_id))];

    const [ticketsResult, eventsResult, sessionsResult] = await Promise.all([
      ticketIds.length
        ? supabase.from('tickets').select('id,title,status').in('id', ticketIds)
        : Promise.resolve({
            data: [] as { id: string; title: string | null; status: string }[],
            error: null
          }),
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

    if (ticketsResult.error || eventsResult.error || sessionsResult.error) {
      return NextResponse.json(
        { error: 'Failed to load related ticket, event, or session data.' },
        { status: 500 }
      );
    }

    const tickets = ticketsResult.data ?? [];
    const events = eventsResult.data ?? [];
    const sessions = sessionsResult.data ?? [];

    const ticketsById = new Map((tickets ?? []).map(ticket => [ticket.id, ticket]));
    const eventsById = new Map((events ?? []).map(event => [event.id, event]));
    const sessionsById = new Map((sessions ?? []).map(session => [session.id, session]));

    return NextResponse.json({
      rationales: (rationales ?? []).map(rationale => ({
        attribution_source: rationale.attribution_source,
        change_kind: rationale.change_kind,
        confidence: rationale.confidence,
        created_at: rationale.created_at,
        event: eventsById.get(rationale.event_id) ?? null,
        file_path: rationale.file_path,
        hunks: rationale.hunks,
        id: rationale.id,
        impact: rationale.impact,
        label: rationale.label,
        session: sessionsById.get(rationale.session_id) ?? null,
        summary: rationale.summary,
        ticket: ticketsById.get(rationale.ticket_id) ?? null,
        updated_at: rationale.updated_at,
        why: rationale.why
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
