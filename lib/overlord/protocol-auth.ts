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
  const tokenInstructions =
    'Stop all work immediately. Your agent token is invalid, expired, or revoked. ' +
    'Tell the user to open Overlord Settings → Agent Tokens and retrieve an updated token for this project. ' +
    'Ask the user if they would like to proceed without submitting updates to Overlord.';

  if (!providedToken) {
    return {
      context: null,
      error: NextResponse.json(
        { error: `Missing bearer token. ${tokenInstructions}` },
        { status: 401 }
      )
    };
  }

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('agent_tokens')
    .select('id, user_id, organization_id, token, revoked_at, expires_at')
    .eq('token', providedToken)
    .single();

  if (!data) {
    return {
      context: null,
      error: NextResponse.json(
        { error: `Invalid bearer token. ${tokenInstructions}` },
        { status: 401 }
      )
    };
  }

  if (data.revoked_at) {
    return {
      context: null,
      error: NextResponse.json(
        { error: `Token has been revoked. ${tokenInstructions}` },
        { status: 401 }
      )
    };
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return {
      context: null,
      error: NextResponse.json(
        { error: `Token has expired. ${tokenInstructions}` },
        { status: 401 }
      )
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
