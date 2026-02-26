import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { createServiceRoleClient } from '@/supabase/utils/service-role';

const LOCAL_SECRET_HEADER = 'x-overlord-local-secret';

export type AgentTokenContext = {
  userId: string;
  organizationId: number;
  tokenId: string;
  tokenValue: string;
};

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.replace('Bearer ', '').trim();
}

function resolveLocalSecretError(request: Request): NextResponse | null {
  const expectedSecret = process.env.OVERLORD_LOCAL_SECRET?.trim();
  if (!expectedSecret) return null;

  const providedSecret = request.headers.get(LOCAL_SECRET_HEADER)?.trim() ?? '';
  const providedBytes = Buffer.from(providedSecret, 'utf8');
  const expectedBytes = Buffer.from(expectedSecret, 'utf8');
  const isMatch =
    providedBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(providedBytes, expectedBytes);

  if (!providedSecret || !isMatch) {
    return NextResponse.json({ error: 'Missing or invalid local secret.' }, { status: 401 });
  }

  return null;
}

/**
 * Resolves an agent token from the Authorization header.
 * Returns a context object with user/org info on success, or a 401 NextResponse on failure.
 */
export async function resolveAgentToken(
  request: Request
): Promise<{ context: AgentTokenContext; error: null } | { context: null; error: NextResponse }> {
  const localSecretError = resolveLocalSecretError(request);
  if (localSecretError) {
    return {
      context: null,
      error: localSecretError
    };
  }

  const providedToken = extractBearerToken(request);
  if (!providedToken) {
    return {
      context: null,
      error: NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 })
    };
  }

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('agent_tokens')
    .select('id, user_id, organization_id, token')
    .eq('token', providedToken)
    .single();

  if (!data) {
    return {
      context: null,
      error: NextResponse.json({ error: 'Invalid bearer token.' }, { status: 401 })
    };
  }

  // Fire-and-forget last_used_at update
  supabase
    .from('agent_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    context: {
      userId: data.user_id,
      organizationId: data.organization_id,
      tokenId: data.id,
      tokenValue: providedToken
    },
    error: null
  };
}
