import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

import { assertOrgMembership } from '@/app/api/projects/_lib';
import { createClientForRequest } from '@/supabase/utils/server';

type RouteContext = { params: Promise<{ projectId: string }> };

interface HotspotRow {
  file_path: string;
  file_name: string;
  ticket_count: number;
  rationale_count: number;
  high_impact_count: number;
  medium_impact_count: number;
  low_impact_count: number;
  impact_score: number;
  last_activity: string;
  ticket_ids: string[];
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);

    const windowDays = Math.min(
      Math.max(parseInt(url.searchParams.get('windowDays') ?? '90', 10) || 90, 1),
      365
    );
    const includeCompleted = url.searchParams.get('includeCompleted') !== 'false';
    const directory = url.searchParams.get('directory') || null;
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '300', 10) || 300, 1),
      1000
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

    const { data: rpcRows, error: rpcError } = await supabase.rpc('get_project_hotspots', {
      p_project_id: projectId,
      p_window_days: windowDays,
      p_include_completed: includeCompleted,
      p_directory: directory,
      p_limit: limit
    });

    if (rpcError) {
      Sentry.captureException(new Error(`Hotspot RPC failed: ${rpcError.message}`), {
        tags: { feature: 'project-graph', rpcName: 'get_project_hotspots' },
        extra: { projectId, windowDays, code: rpcError.code }
      });
      return NextResponse.json({ error: 'Failed to load hotspot data.' }, { status: 500 });
    }

    const hotspots = (rpcRows ?? []) as HotspotRow[];

    return NextResponse.json({ hotspots, windowDays });
  } catch (error) {
    Sentry.captureException(error, { tags: { feature: 'project-graph' } });
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
