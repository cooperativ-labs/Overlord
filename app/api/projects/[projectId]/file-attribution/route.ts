import { NextResponse } from 'next/server';

import { createClient } from '@/supabase/utils/server';

type RouteContext = { params: Promise<{ projectId: string }> };

type FileAttribution = {
  file_path: string;
  ticket_id: string;
  ticket_title: string | null;
};

/**
 * Parses file paths from a `file_changes` artifact content string.
 * Supports formats: plain paths, bullet lists, git --stat format, em-dash notes.
 */
function parseFilePaths(content: string): string[] {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .flatMap(line => {
      if (/^\d+\s+files?\s+changed/.test(line)) return [];
      const stripped = line.replace(/^[-*]\s+/, '');
      const gitStat = stripped.match(/^(.+?)\s+\|\s+\d+/);
      if (gitStat) return [gitStat[1].trim()];
      const emDash = stripped.match(/^(.+?)\s+[—–]\s+(.+)$/);
      if (emDash) return [emDash[1].trim()];
      return [stripped];
    })
    .filter(p => p.includes('/') || p.includes('.'));
}

/**
 * Returns deterministic file-to-ticket attribution for a project.
 * Sources: `file_changes` artifacts from agent deliveries, joined with ticket data.
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

    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle();

    if (projectError || !project) {
      return NextResponse.json(
        { error: projectError?.message ?? 'Project not found.' },
        { status: 404 }
      );
    }

    // Get file_changes artifacts for tickets in this project, joined with ticket data.
    const { data: artifacts, error: artifactError } = await supabase
      .from('artifacts')
      .select('content,ticket_id,tickets!inner(id,title,project_id)')
      .eq('artifact_type', 'file_changes')
      .eq('tickets.project_id', projectId)
      .not('content', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500);

    if (artifactError) {
      return NextResponse.json({ error: artifactError.message }, { status: 500 });
    }

    const attributions: FileAttribution[] = [];
    const seen = new Set<string>();

    for (const artifact of artifacts ?? []) {
      if (!artifact.content || !artifact.ticket_id) continue;
      const filePaths = parseFilePaths(artifact.content);
      const ticket = artifact.tickets as unknown as { id: string; title: string | null };

      for (const filePath of filePaths) {
        if (requestedPaths.size > 0 && !requestedPaths.has(filePath)) continue;
        const key = `${filePath}::${artifact.ticket_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        attributions.push({
          file_path: filePath,
          ticket_id: ticket.id,
          ticket_title: ticket.title
        });
      }
    }

    return NextResponse.json({ attributions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
