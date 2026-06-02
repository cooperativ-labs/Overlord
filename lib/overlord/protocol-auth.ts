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

async function resolveProtocolOrganizationHintForProjectId(
  projectId: string
): Promise<number | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('projects')
    .select('organization_id')
    .eq('id', projectId.trim())
    .maybeSingle();

  if (error || !data || typeof data.organization_id !== 'number') return null;
  return data.organization_id;
}

async function resolveProtocolOrganizationHintForResourceId(
  resourceId: string
): Promise<number | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('project_resource_directories')
    .select('projects!inner(organization_id)')
    .eq('id', resourceId.trim())
    .maybeSingle();

  if (error || !data) return null;
  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  return typeof project?.organization_id === 'number' ? project.organization_id : null;
}

async function resolveProtocolOrganizationHintForObjectiveId(
  objectiveId: string
): Promise<number | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('objectives')
    .select('tickets!inner(organization_id)')
    .eq('id', objectiveId.trim())
    .maybeSingle();

  if (error || !data) return null;
  const ticket = Array.isArray(data.tickets) ? data.tickets[0] : data.tickets;
  return typeof ticket?.organization_id === 'number' ? ticket.organization_id : null;
}

async function resolveProtocolOrganizationHintForRequestId(
  requestId: string
): Promise<number | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('execution_requests')
    .select('organization_id')
    .eq('id', requestId.trim())
    .maybeSingle();

  if (error || !data || typeof data.organization_id !== 'number') return null;
  return data.organization_id;
}

/**
 * Resolves a single-organization protocol hint from stable object identifiers in
 * a request body before auth membership checks. This prevents sessionless
 * commands from falling back to the caller's first membership when the payload
 * already names an object that belongs to a different organization.
 */
export async function resolveProtocolOrganizationHintForBody(
  body: unknown
): Promise<number | null> {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;

  if (typeof record.ticketId === 'string' && record.ticketId.trim()) {
    const fromTicket = await resolveProtocolOrganizationHintForTicketId({
      ticketId: record.ticketId.trim()
    });
    if (fromTicket !== null) return fromTicket;
  }

  if (typeof record.projectId === 'string' && record.projectId.trim()) {
    const fromProject = await resolveProtocolOrganizationHintForProjectId(record.projectId);
    if (fromProject !== null) return fromProject;
  }

  if (typeof record.resourceId === 'string' && record.resourceId.trim()) {
    const fromResource = await resolveProtocolOrganizationHintForResourceId(record.resourceId);
    if (fromResource !== null) return fromResource;
  }

  if (typeof record.objectiveId === 'string' && record.objectiveId.trim()) {
    const fromObjective = await resolveProtocolOrganizationHintForObjectiveId(record.objectiveId);
    if (fromObjective !== null) return fromObjective;
  }

  if (typeof record.requestId === 'string' && record.requestId.trim()) {
    const fromRequest = await resolveProtocolOrganizationHintForRequestId(record.requestId);
    if (fromRequest !== null) return fromRequest;
  }

  return null;
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
  authMethod: 'oauth_jwt' | 'local_dev_token' | 'agent_token';
};

/** Per-user agent tokens (`OVERLORD_AGENT_TOKEN`) are minted in Settings → Agents & MCP. */
const AGENT_TOKEN_PREFIX = 'oat_';

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

function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Resolves the organization a protocol request runs in from the caller's
 * membership. There is no stored "default organization": the identity (OAuth
 * session, agent token, or local dev) resolves to the set of organizations it
 * belongs to, and the request is scoped within that set.
 *
 * - An explicit hint (ticket id, `x-organization-id`, or `--organization-id`)
 *   must name an organization the caller belongs to. If it does not, that is a
 *   permission error (403) — never a silent fall-back to another org.
 * - With no hint, the request is scoped to the caller's organization membership.
 *   A caller with no memberships gets a clear 403.
 *
 * Shared by the OAuth and agent-token paths so both behave identically.
 */
async function resolveOrganizationMembership(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  organizationIdHint: number | null
): Promise<{ organizationId: number | null; error: NextResponse | null }> {
  if (organizationIdHint !== null && Number.isFinite(organizationIdHint)) {
    const { data: targetMember, error } = await supabase
      .from('members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('organization_id', organizationIdHint)
      .maybeSingle();

    if (error) {
      return {
        organizationId: null,
        error: NextResponse.json({ error: error.message }, { status: 500 })
      };
    }

    if (!targetMember) {
      return {
        organizationId: null,
        error: NextResponse.json(
          {
            error:
              `You are not a member of organization ${organizationIdHint}, or it does not exist. ` +
              'Choose an organization you belong to (run `ovld protocol list-organizations`).'
          },
          { status: 403 }
        )
      };
    }

    return { organizationId: targetMember.organization_id, error: null };
  }

  const { data: member, error } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('organization_id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      organizationId: null,
      error: NextResponse.json({ error: error.message }, { status: 500 })
    };
  }

  return { organizationId: member?.organization_id ?? null, error: null };
}

/**
 * Resolves a per-user agent token (`oat_` prefix). These are long-lived, hashed
 * tokens stored in `user_agent_tokens`, identical to the MCP agent-token path
 * (supabase/functions/mcp/auth.ts). They carry no expiry, so a CLI running apart
 * from Desktop can stay authenticated without an OAuth refresh loop.
 *
 * The organization is resolved from the user's membership via
 * resolveOrganizationMembership: a ticket/header hint is honored when the user
 * belongs to that org (403 otherwise), and a missing hint scopes to membership.
 */
async function resolveAgentTokenContext(
  providedToken: string,
  organizationIdHint: number | null
): Promise<{ context: ProtocolAuthContext | null; error: NextResponse | null }> {
  const supabase = createServiceRoleClient();
  const tokenHash = hashAgentToken(providedToken);

  const { data: tokenRow, error: tokenError } = await supabase
    .from('user_agent_tokens')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (tokenError) {
    return {
      context: null,
      error: NextResponse.json({ error: tokenError.message }, { status: 500 })
    };
  }

  if (!tokenRow) {
    // Unknown/revoked token — fall through to the standard invalid-token response.
    return { context: null, error: null };
  }

  const { organizationId, error: orgError } = await resolveOrganizationMembership(
    supabase,
    tokenRow.user_id,
    organizationIdHint
  );
  if (orgError) {
    return { context: null, error: orgError };
  }

  if (organizationId === null) {
    return {
      context: null,
      error: NextResponse.json(
        { error: 'Agent token is not a member of any organization.' },
        { status: 403 }
      )
    };
  }

  // Fire-and-forget last-used bookkeeping; never blocks the request.
  void supabase
    .from('user_agent_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash);

  return {
    context: {
      userId: tokenRow.user_id,
      organizationId,
      tokenValue: providedToken,
      authMethod: 'agent_token'
    },
    error: null
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

  // OAuth sessions are org-agnostic, matching the agent-token path: an explicit
  // hint must name an org the user belongs to (403 otherwise), and a missing hint
  // is resolved from membership rather than rejected with a required header.
  const supabase = createServiceRoleClient();
  const { organizationId, error: orgError } = await resolveOrganizationMembership(
    supabase,
    userId,
    organizationIdHint
  );
  if (orgError) {
    return { context: null, error: orgError };
  }

  if (organizationId === null) {
    return {
      context: null,
      error: NextResponse.json(
        { error: 'This account is not a member of any organization.' },
        { status: 403 }
      )
    };
  }

  return {
    context: {
      userId,
      organizationId,
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

  // Agent token path — prefix-routed so we never attempt JWT validation on it.
  if (providedToken.startsWith(AGENT_TOKEN_PREFIX)) {
    const agentResult = await resolveAgentTokenContext(
      providedToken,
      organizationIdOverride ?? parseOrganizationIdHeader(request)
    );
    if (agentResult.error) {
      return { context: null, error: agentResult.error };
    }
    if (agentResult.context) {
      return { context: agentResult.context, error: null };
    }
    return {
      context: null,
      error: NextResponse.json(
        { error: `Invalid bearer token. ${reauthInstructions}` },
        { status: 401 }
      )
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
