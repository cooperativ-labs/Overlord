import { createRemoteJWKSet, jwtVerify } from 'jose';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { getSupabaseUrl } from '@/lib/env';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

const LOCAL_SECRET_HEADER = 'x-overlord-local-secret';
const LOCAL_DEV_TOKEN = 'overlord-local-dev-token';
const LOCAL_DEV_USER_ID = '11111111-1111-4111-8111-111111111111';
const LOCAL_DEV_ORGANIZATION_ID = 1;

const TICKET_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseHumanReadableTicketOrganizationId(ticketId: string): number | null {
  const trimmed = ticketId.trim();
  const [organizationPart, ticketSequencePart, ...rest] = trimmed.split(':');
  if (rest.length > 0) return null;

  const organizationId = Number.parseInt(organizationPart ?? '', 10);
  const ticketSequence = Number.parseInt(ticketSequencePart ?? '', 10);
  if (!Number.isInteger(organizationId) || organizationId <= 0) return null;
  if (!Number.isInteger(ticketSequence) || ticketSequence <= 0) return null;

  return organizationId;
}

/**
 * Resolves the organization scope for a protocol ticket id before OAuth membership checks.
 * - Human ids (`org:sequence`) take org from the prefix (no DB).
 * - UUID ids load `organization_id` from `tickets` so clients are not dependent on a
 *   correct `x-organization-id` header (fixes stale Desktop credential org vs ticket org).
 */
export async function resolveProtocolOrganizationHintForTicketId({
  ticketId
}: {
  ticketId: string;
}): Promise<number | null> {
  const trimmed = ticketId.trim();
  const fromHuman = parseHumanReadableTicketOrganizationId(trimmed);
  if (fromHuman !== null) return fromHuman;

  if (!TICKET_UUID_REGEX.test(trimmed)) return null;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('tickets')
    .select('organization_id')
    .eq('id', trimmed)
    .maybeSingle();

  if (error || !data || typeof data.organization_id !== 'number') return null;
  return data.organization_id;
}

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
  tokenValue: string;
  authMethod: 'oauth_jwt' | 'local_dev_token';
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

function parseOrganizationIdHeader(request: Request): number | null {
  const raw = request.headers.get('x-organization-id')?.trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLocalDevRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    return url.protocol === 'http:' && url.hostname === 'localhost' && url.port === '3000';
  } catch {
    return false;
  }
}

function resolveLocalDevTokenContext(
  request: Request,
  providedToken: string,
  organizationIdOverride?: number | null
): ProtocolAuthContext | null {
  if (providedToken !== LOCAL_DEV_TOKEN || !isLocalDevRequest(request)) return null;

  return {
    userId: LOCAL_DEV_USER_ID,
    organizationId: organizationIdOverride ?? LOCAL_DEV_ORGANIZATION_ID,
    tokenValue: providedToken,
    authMethod: 'local_dev_token'
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
  request: Request,
  organizationIdOverride?: number | null
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
    'First run `ovld auth repair` yourself. If repair does not fix it, ask the user to sign in again with Overlord Desktop or `ovld auth login` if needed. ' +
    'Then ask whether they would like to proceed without submitting updates to Overlord.';

  if (!providedToken) {
    return {
      context: null,
      error: NextResponse.json(
        { error: `Missing bearer token. ${reauthInstructions}` },
        { status: 401 }
      )
    };
  }

  const localDevContext = resolveLocalDevTokenContext(
    request,
    providedToken,
    organizationIdOverride
  );
  if (localDevContext) {
    return {
      context: localDevContext,
      error: null
    };
  }

  const oauthResult = await resolveOAuthJwtContext(
    providedToken,
    organizationIdOverride ?? parseOrganizationIdHeader(request)
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
