import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';

import { assertOrgMembership } from '@/app/api/projects/_lib';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { getPrimaryProjectResourceDirectoriesByProjectId } from '@/lib/resource-directories/primary-resource';
import { createClientForRequest } from '@/supabase/utils/server';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
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
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: projectError?.message ?? 'Project not found.' },
        { status: projectError?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    if (!(await assertOrgMembership(supabase, user.id, project.organization_id))) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const primaryResources = await getPrimaryProjectResourceDirectoriesByProjectId(supabase, {
      userId: user.id,
      projectIds: [project.id]
    });

    const resolvedRoot = resolveLinkedDirectory(
      primaryResources.get(project.id)?.directoryPath ?? null
    );
    if (resolvedRoot) {
      const stat = await fs.stat(resolvedRoot).catch(() => null);
      if (stat?.isDirectory()) {
        const { files, truncated } = await listProjectFiles(resolvedRoot);
        return NextResponse.json({ files, linkedDirectory: resolvedRoot, truncated });
      }
    }

    return NextResponse.json({ files: [], linkedDirectory: null, truncated: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
