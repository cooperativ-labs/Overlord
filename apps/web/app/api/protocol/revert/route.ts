import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { revertSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, revertSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { objectiveId } = parsed.data;
    const { organizationId } = parsed.tokenContext;

    const { data: checkpoint, error } = await supabase
      .from('project_checkpoints')
      .select(
        'id,organization_id,project_id,ticket_id,objective_id,checkpoint_kind,git_commit_id,git_ref_name,head_sha,diff_stat,created_at,updated_at'
      )
      .eq('organization_id', organizationId)
      .eq('objective_id', objectiveId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!checkpoint) {
      return NextResponse.json({ error: 'Checkpoint not found.' }, { status: 404 });
    }
    if (!checkpoint.git_commit_id) {
      return NextResponse.json(
        { error: 'Checkpoint does not have a git commit.' },
        { status: 409 }
      );
    }

    return NextResponse.json({ checkpoint });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
