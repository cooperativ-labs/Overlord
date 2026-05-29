// CLI-support endpoint — not a cross-surface protocol operation (mirrors the
// `projects` route). Supplies the built-in agent catalog plus the authenticated
// user's custom agents so `ovld <agent>` can classify and launch by id. The
// CLI overlays its own local connector-manifest check for the `installed` flag,
// which the server cannot see.
import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { AGENT_TYPES } from '@/lib/helpers/agent-types';
import { resolveAgentToken } from '@/lib/overlord/protocol-auth';
import { agentConfigSchema, CUSTOM_AGENTS_CONFIG_KEY } from '@/lib/schemas/agent-config';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function GET(request: Request) {
  const authResult = await resolveAgentToken(request);
  if (authResult.error) return authResult.error;

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('user_agent_configs')
      .select('config')
      .eq('user_id', authResult.context.userId)
      .eq('agent_type', CUSTOM_AGENTS_CONFIG_KEY)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const parsed = data?.config ? agentConfigSchema.parse(data.config) : null;
    const customAgents = parsed?.customAgents ?? [];

    return NextResponse.json({
      builtins: AGENT_TYPES.map(agent => ({ value: agent.value, label: agent.label })),
      customAgents
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
