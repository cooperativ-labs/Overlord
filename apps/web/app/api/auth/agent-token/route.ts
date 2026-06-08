import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { createAgentTokenForUser } from '@/lib/overlord/agent-tokens';
import { createUserScopedAuthClient } from '@/lib/overlord/cli-auth';
import { agentTokenCreateSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim() || null;
}

/**
 * POST /api/auth/agent-token
 *
 * Mints a durable `oat_…` agent token for the authenticated user. Called by the
 * CLI right after signup/email-login so headless agents get a long-lived,
 * revocable credential instead of relying on short-lived Supabase access JWTs.
 * Only the SHA-256 hash and prefix are stored server-side; the full token is
 * returned exactly once. Revocation/listing stay in Settings → Agents & MCP.
 */
export async function POST(request: Request) {
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Missing bearer token.', code: 'unauthenticated' },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = agentTokenCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload.', code: 'invalid_payload' },
      { status: 400 }
    );
  }

  try {
    // Validate the session and resolve the owner via the service role, then mint
    // through a user-scoped client so the RLS WITH CHECK (user_id = auth.uid())
    // policy on user_agent_tokens is satisfied.
    const service = createServiceRoleClient();
    const {
      data: { user },
      error: userError
    } = await service.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Invalid or expired token.', code: 'unauthenticated' },
        { status: 401 }
      );
    }

    const userClient = createUserScopedAuthClient(accessToken);
    const { token, info } = await createAgentTokenForUser(userClient, user.id, parsed.data.label);

    return NextResponse.json({ token, info });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
