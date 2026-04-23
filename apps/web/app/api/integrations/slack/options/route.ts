/**
 * Slack external_select options endpoint.
 * Returns the user's projects and ticket statuses for use in Slack modals.
 */
import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const body = await request.text();
  const params = new URLSearchParams(body);
  const payloadStr = params.get('payload');
  if (!payloadStr) {
    return NextResponse.json({ options: [] });
  }

  let payload: {
    type?: string;
    action_id?: string;
    value?: string;
    team?: { id: string };
    user?: { id: string };
  };
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return NextResponse.json({ options: [] });
  }

  if (payload.type !== 'external_select') {
    return NextResponse.json({ options: [] });
  }

  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!teamId || !slackUserId) return NextResponse.json({ options: [] });

  const supabase = createServiceRoleClient();

  // Resolve the Overlord user from the workspace row
  const { data: workspace } = await supabase
    .from('slack_workspaces')
    .select('user_id,organization_id')
    .eq('team_id', teamId)
    .eq('slack_user_id', slackUserId)
    .maybeSingle();

  if (!workspace) return NextResponse.json({ options: [] });

  const actionId = payload.action_id ?? '';

  if (actionId === 'select_project') {
    const { data: projects } = await supabase
      .from('projects')
      .select('id,name')
      .eq('organization_id', workspace.organization_id)
      .order('name');

    const options = (projects ?? []).map(p => ({
      text: { type: 'plain_text', text: p.name },
      value: p.id
    }));
    return NextResponse.json({ options });
  }

  if (actionId === 'select_status') {
    const { data: statuses } = await supabase
      .from('ticket_statuses')
      .select('name')
      .eq('organization_id', workspace.organization_id)
      .order('position');

    const options = (statuses ?? []).map(s => ({
      text: { type: 'plain_text', text: s.name },
      value: s.name
    }));
    return NextResponse.json({ options });
  }

  return NextResponse.json({ options: [] });
}
