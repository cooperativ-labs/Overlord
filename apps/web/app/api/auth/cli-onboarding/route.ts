import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env';
import { deriveTitleFromObjective, getTicketIdentifier } from '@/lib/helpers/tickets';
import { insertOrderedObjectives } from '@/lib/objectives';
import { acceptInvitationForUser } from '@/lib/overlord/invitations';
import {
  createProjectRecord,
  registerProjectResourceDirectory
} from '@/lib/overlord/project-provisioning';
import { cliOnboardingSchema } from '@/lib/overlord/validation';
import { resolvePreferredStatusNameByType } from '@/lib/ticket-statuses';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

const ONBOARDING_TICKET_OBJECTIVE =
  'conduct a code review of this repository, save it as a Markdown file, then create objectives on this ticket for the top three most critical fixes';

/**
 * Raised when an invite token cannot be consumed (expired, already used, etc.).
 * Surfaced to the CLI as a 400 with an agent-readable message.
 */
class InviteResolutionError extends Error {}

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token || null;
}

function createUserScopedSupabase(accessToken: string) {
  return createClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

async function resolveOrCreateOrganization(input: {
  accessToken: string;
  organizationName: string;
  userId: string;
}) {
  const service = createServiceRoleClient();
  const { data: existingMemberships, error: membershipError } = await service
    .from('members')
    .select('organization_id, organizations(name)')
    .eq('user_id', input.userId)
    .order('organization_id', { ascending: true });

  if (membershipError) throw new Error(membershipError.message);

  const existing = existingMemberships?.[0];
  if (existing?.organization_id) {
    const organization = Array.isArray(existing.organizations)
      ? existing.organizations[0]
      : existing.organizations;
    return {
      created: false,
      organizationId: existing.organization_id,
      organizationName: organization?.name ?? input.organizationName
    };
  }

  const userSupabase = createUserScopedSupabase(input.accessToken);
  const { data, error } = await userSupabase.rpc('create_organization_for_current_user', {
    target_name: input.organizationName
  });

  if (error) throw new Error(error.message ?? 'Failed to create organization.');

  return {
    created: true,
    organizationId: data as number,
    organizationName: input.organizationName
  };
}

/**
 * Invite path: consume the invitation token and join the inviting org with the
 * invited role instead of creating a new org. Email match is soft — possession
 * of the single-use, expiring token plus an authenticated account is sufficient
 * authority to join (see ticket 1:1358).
 */
async function resolveOrganizationFromInvite(input: {
  inviteToken: string;
  userId: string;
  userEmail: string | null | undefined;
}) {
  const result = await acceptInvitationForUser({
    token: input.inviteToken,
    userId: input.userId,
    userEmail: input.userEmail,
    enforceEmailMatch: false
  });

  if (!result.ok) {
    throw new InviteResolutionError(result.error);
  }

  return {
    created: false,
    organizationId: result.organizationId,
    organizationName: result.organizationName ?? '',
    role: result.role
  };
}

async function createOnboardingTicket(input: {
  organizationId: number;
  projectId: string;
  userId: string;
}) {
  const supabase = createServiceRoleClient();
  const draftStatusName = await resolvePreferredStatusNameByType(
    supabase,
    input.organizationId,
    'draft'
  );
  const title = deriveTitleFromObjective(ONBOARDING_TICKET_OBJECTIVE);

  // Idempotency: if onboard was already run for this project, reuse the existing
  // onboarding ticket instead of creating another one (with another objective).
  const { data: existingTicket } = await supabase
    .from('tickets')
    .select('id,ticket_id,ticket_sequence,organization_id,project_id,status,title')
    .eq('project_id', input.projectId)
    .eq('title', title)
    .limit(1)
    .maybeSingle();

  if (existingTicket) {
    return {
      id: existingTicket.id,
      reference: getTicketIdentifier(existingTicket),
      status: existingTicket.status,
      title: existingTicket.title,
      objectiveId: null
    };
  }

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      created_by: input.userId,
      for_human: true,
      organization_id: input.organizationId,
      priority: 'medium',
      project_id: input.projectId,
      status: draftStatusName,
      title
    })
    .select('id,ticket_id,ticket_sequence,organization_id,project_id,status,title')
    .single();

  if (error || !ticket) {
    throw new Error(error?.message ?? 'Failed to create onboarding ticket.');
  }

  const objectives = await insertOrderedObjectives(
    supabase,
    ticket.id,
    [{ objective: ONBOARDING_TICKET_OBJECTIVE }],
    {
      createdBy: input.userId,
      firstState: 'draft'
    }
  );

  return {
    id: ticket.id,
    reference: getTicketIdentifier(ticket),
    status: ticket.status,
    title: ticket.title,
    objectiveId: objectives[0]?.id ?? null
  };
}

async function updateProfile(input: { userId: string; name: string; organizationId: number }) {
  const supabase = createServiceRoleClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding,preferences')
    .eq('id', input.userId)
    .maybeSingle();

  const current =
    profile?.onboarding &&
    typeof profile.onboarding === 'object' &&
    !Array.isArray(profile.onboarding)
      ? profile.onboarding
      : {};
  const currentPreferences =
    profile?.preferences &&
    typeof profile.preferences === 'object' &&
    !Array.isArray(profile.preferences)
      ? profile.preferences
      : {};

  const { error } = await supabase
    .from('profiles')
    .update({
      name: input.name,
      onboarding: {
        ...current,
        completed_step: 6,
        skipped: false,
        desktop_setup_done: false,
        desktop_completed_step: 0,
        invited_organization_id: null
      },
      preferences: {
        ...currentPreferences,
        active_organization_id: input.organizationId
      }
    })
    .eq('id', input.userId);

  if (error) {
    throw new Error(error.message ?? 'Failed to update onboarding profile.');
  }
}

export async function POST(request: Request) {
  // Auth note: unlike the protocol routes, this endpoint authenticates solely on the
  // Supabase user JWT (validated via getUser below). The CLI also sends the local-secret
  // header for parity, but it is intentionally not required here — the action is fully
  // user-scoped and the JWT is authoritative.
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = cliOnboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload.' },
      { status: 400 }
    );
  }

  try {
    const service = createServiceRoleClient();
    const {
      data: { user },
      error: userError
    } = await service.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid or expired token.' }, { status: 401 });
    }

    const inviteToken = parsed.data.inviteToken;
    const organization = inviteToken
      ? await resolveOrganizationFromInvite({
          inviteToken,
          userId: user.id,
          userEmail: user.email
        })
      : await resolveOrCreateOrganization({
          accessToken,
          // organizationName is required by the schema whenever inviteToken is absent.
          organizationName: parsed.data.organizationName as string,
          userId: user.id
        });
    const project = await createProjectRecord({
      supabase: service,
      organizationId: organization.organizationId,
      name: parsed.data.projectName,
      reuseExistingByName: true
    });
    const resource = await registerProjectResourceDirectory({
      supabase: service,
      organizationId: organization.organizationId,
      projectId: project.id,
      userId: user.id,
      directoryPath: parsed.data.directoryPath,
      deviceFingerprint: parsed.data.deviceFingerprint,
      deviceHostname: parsed.data.deviceHostname,
      devicePlatform: parsed.data.devicePlatform
    });
    // Skip the auto onboarding ticket on the invite path — the inviting org
    // already has work, and the agent receives real tickets from it (1:1358).
    const ticket = inviteToken
      ? null
      : await createOnboardingTicket({
          organizationId: organization.organizationId,
          projectId: project.id,
          userId: user.id
        });

    await updateProfile({
      userId: user.id,
      name: parsed.data.name,
      organizationId: organization.organizationId
    });

    return NextResponse.json({
      ok: true,
      organization,
      project: {
        id: project.id,
        name: project.name,
        organizationId: project.organization_id
      },
      resource,
      ticket
    });
  } catch (error) {
    if (error instanceof InviteResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return internalErrorResponse(error);
  }
}
