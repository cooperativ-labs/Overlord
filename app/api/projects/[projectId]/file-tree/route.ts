import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';

import { assertOrgMembership } from '@/app/api/projects/_lib';
import {
  listProjectFiles,
  listRemoteProjectFiles,
  resolveLinkedDirectory
} from '@/lib/filesystem/project-file-tree';
import { createClient } from '@/supabase/utils/server';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id,organization_id,local_working_directory,ssh_command,remote_working_directory')
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

    // Try local directory first
    const resolvedRoot = resolveLinkedDirectory(project.local_working_directory);
    if (resolvedRoot) {
      const stat = await fs.stat(resolvedRoot).catch(() => null);
      if (stat?.isDirectory()) {
        const { files, truncated } = await listProjectFiles(resolvedRoot);
        return NextResponse.json({ files, linkedDirectory: resolvedRoot, truncated });
      }
    }

    // Fall back to SSH if configured
    const sshCommand = project.ssh_command?.trim();
    const remoteDir = project.remote_working_directory?.trim();
    if (sshCommand && remoteDir) {
      try {
        const { files, truncated } = await listRemoteProjectFiles(sshCommand, remoteDir);
        return NextResponse.json({ files, linkedDirectory: remoteDir, truncated });
      } catch (error) {
        return NextResponse.json({
          files: [],
          linkedDirectory: remoteDir,
          truncated: false,
          error: error instanceof Error ? error.message : 'Failed to list remote project files.'
        });
      }
    }

    return NextResponse.json({ files: [], linkedDirectory: null, truncated: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
