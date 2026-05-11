import { NextResponse } from 'next/server';

import { assertOrgMembership, chunkUuidListForPostgrestNotIn } from '@/app/api/projects/_lib';
import { createClientForRequest } from '@/supabase/utils/server';

type RouteContext = { params: Promise<{ projectId: string }> };

type FileAttribution = {
  file_path: string;
  ticket_id: string;
  ticket_title: string | null;
};

/**
 * Returns deterministic file-to-ticket attribution for a project.
 * Source: first-class `file_changes` rows, joined with ticket data.
 * Query params: `filePath` (repeatable) to filter to specific files.
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);
    const requestedPaths = new Set(
      url.searchParams
        .getAll('filePath')
        .map(v => v.trim())
        .filter(Boolean)
    );
    const includeCompleted = url.searchParams.get('includeCompleted') === 'true';

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

    // When not including completed tickets, resolve which ticket IDs to exclude.
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

        excludedTicketIds = (excludedTickets ?? []).map((t: { id: string }) => t.id);
      }
    }

    let fileChangeQuery = supabase
      .from('file_changes')
      .select('file_path,ticket_id,tickets!inner(id,title,project_id)')
      .eq('tickets.project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(500);

    for (const chunk of chunkUuidListForPostgrestNotIn(excludedTicketIds)) {
      fileChangeQuery = fileChangeQuery.not('ticket_id', 'in', `(${chunk.join(',')})`);
    }

    const { data: fileChanges, error: fileChangeError } = await fileChangeQuery;

    if (fileChangeError) {
      return NextResponse.json({ error: fileChangeError.message }, { status: 500 });
    }

    const attributions: FileAttribution[] = [];
    const seen = new Set<string>();

    for (const fileChange of fileChanges ?? []) {
      if (!fileChange.file_path || !fileChange.ticket_id) continue;
      if (requestedPaths.size > 0 && !requestedPaths.has(fileChange.file_path)) continue;
      const ticket = fileChange.tickets as unknown as { id: string; title: string | null };
      const key = `${fileChange.file_path}::${fileChange.ticket_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      attributions.push({
        file_path: fileChange.file_path,
        ticket_id: ticket.id,
        ticket_title: ticket.title
      });
    }

    return NextResponse.json({ attributions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
