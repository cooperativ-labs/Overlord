import { createRemoteJWKSet, jwtVerify } from 'jose';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { getSupabaseUrl } from '@/lib/env';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

const LOCAL_SECRET_HEADER = 'x-overlord-local-secret';

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedIssuer: string | null = null;

function getSupabaseJwks(): { jwks: ReturnType<typeof createRemoteJWKSet>; issuer: string } {
  const supabaseUrl = getSupabaseUrl();
  const issuer = `${supabaseUrl}/auth/v1`;
  if (!cachedJwks || cachedIssuer !== issuer) {
    cachedJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    cachedIssuer = issuer;
  }
  return { jwks: cachedJwks, issuer };
}

export type ProtocolAuthContext = {
  userId: string;
  organizationId: number;
  tokenId: string | null;
  tokenValue: string;
  authMethod: 'agent_token' | 'oauth_jwt';
};

export type AgentTokenContext = ProtocolAuthContext;

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

function parseOrganizationIdHeader(request: Request): number | null {
  const raw = request.headers.get('x-organization-id')?.trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveAgentTokenContext(
  providedToken: string
): Promise<ProtocolAuthContext | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('agent_tokens')
    .select('id, user_id, organization_id, token, revoked_at, expires_at')
    .eq('token', providedToken)
    .single();

  if (!data || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  supabase
    .from('agent_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    userId: data.user_id,
    organizationId: data.organization_id,
    tokenId: data.id,
    tokenValue: providedToken,
    authMethod: 'agent_token'
  };
}

async function verifySupabaseJwt(providedToken: string): Promise<string | null> {
  try {
    const { jwks, issuer } = getSupabaseJwks();
    const { payload } = await jwtVerify(providedToken, jwks, { issuer });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

async function resolveOAuthJwtContext(
  providedToken: string,
  organizationIdHint: number | null
): Promise<{ context: ProtocolAuthContext | null; error: NextResponse | null }> {
  const userId = await verifySupabaseJwt(providedToken);
  if (!userId) {
    return { context: null, error: null };
  }

  if (organizationIdHint === null) {
    return {
      context: null,
      error: NextResponse.json(
        { error: 'OAuth-authenticated protocol requests must include x-organization-id.' },
        { status: 400 }
      )
    };
  }

  const supabase = createServiceRoleClient();
  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('organization_id', organizationIdHint)
    .maybeSingle();

  if (memberError) {
    return {
      context: null,
      error: NextResponse.json({ error: memberError.message }, { status: 500 })
    };
  }

  if (!member) {
    return {
      context: null,
      error: NextResponse.json(
        { error: 'Selected organization is not available to this OAuth session.' },
        { status: 403 }
      )
    };
  }

  return {
    context: {
      userId,
      organizationId: member.organization_id,
      tokenId: null,
      tokenValue: providedToken,
      authMethod: 'oauth_jwt'
    },
    error: null
  };
}

/**
 * Resolves protocol auth from the Authorization header.
 * Returns a context object with user/org info on success, or an error response on failure.
 */
export async function resolveProtocolAuth(
  request: Request
): Promise<{ context: ProtocolAuthContext; error: null } | { context: null; error: NextResponse }> {
  const localSecretError = resolveLocalSecretError(request);
  if (localSecretError) {
    return {
      context: null,
      error: localSecretError
    };
  }

  const providedToken = extractBearerToken(request);
  const reauthInstructions =
    'Stop all work immediately. The current Overlord auth session is missing, invalid, or expired. ' +
    'Tell the user to sign in again with Overlord Desktop or `ovld auth login`. ' +
    'Ask the user if they would like to proceed without submitting updates to Overlord.';

  if (!providedToken) {
    return {
      context: null,
      error: NextResponse.json(
        { error: `Missing bearer token. ${reauthInstructions}` },
        { status: 401 }
      )
    };
  }

  const agentContext = await resolveAgentTokenContext(providedToken);
  if (agentContext) {
    return {
      context: agentContext,
      error: null
    };
  }

  const oauthResult = await resolveOAuthJwtContext(
    providedToken,
    parseOrganizationIdHeader(request)
  );
  if (oauthResult.error) {
    return {
      context: null,
      error: oauthResult.error
    };
  }
  if (oauthResult.context) {
    return {
      context: oauthResult.context,
      error: null
    };
  }

  return {
    context: null,
    error: NextResponse.json(
      { error: `Invalid bearer token. ${reauthInstructions}` },
      { status: 401 }
    )
  };
}

export const resolveAgentToken = resolveProtocolAuth;
