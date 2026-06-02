import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import os from 'node:os';
import { z } from 'zod';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env';
import { normalizeHexColor } from '@/lib/helpers/color';
import { deriveTitleFromObjective, getTicketIdentifier } from '@/lib/helpers/tickets';
import { insertOrderedObjectives } from '@/lib/objectives';
import { ensureProjectExecutionTarget } from '@/lib/overlord/execution-targets';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import {
  assertCanManagePrimary,
  clearTargetPrimary,
  shouldAutoPrimary
} from '@/lib/resource-directories/primary-resource';
import { resolvePreferredStatusNameByType } from '@/lib/ticket-statuses';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

const DEFAULT_PROJECT_COLOR = '#fecdd3';
const ONBOARDING_TICKET_OBJECTIVE =
  'conduct a code review of this repository, save it as a Markdown file, then create objectives on this ticket for the top three most critical fixes';

const defaultProjectStatuses = [
  { name: 'draft', status_type: 'draft', position: 0 },
  { name: 'execute', status_type: 'execute', position: 1 },
  { name: 'review', status_type: 'review', position: 2 },
  { name: 'complete', status_type: 'complete', position: 3 }
] as const;

const cliOnboardingSchema = z.object({
  name: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(1).max(120),
  projectName: z.string().trim().min(1).max(160),
  directoryPath: z.string().trim().min(1).max(1024),
  deviceFingerprint: z.string().trim().min(1).max(128),
  deviceHostname: z.string().trim().max(256).optional(),
  devicePlatform: z.string().trim().max(64).optional()
});

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

async function ensureDefaultStatusesForOrganization(input: {
  organizationId: number;
  supabase: ReturnType<typeof createServiceRoleClient>;
}) {
  const { error } = await input.supabase.from('ticket_statuses').upsert(
    defaultProjectStatuses.map(status => ({
      organization_id: input.organizationId,
      name: status.name,
      status_type: status.status_type,
      position: status.position,
      is_default: true
    })),
    {
      onConflict: 'organization_id,name',
      ignoreDuplicates: true
    }
  );

  if (error) {
    throw new Error(error.message ?? 'Failed to initialize default project statuses.');
  }
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

async function createProject(input: { organizationId: number; projectName: string }) {
  const supabase = createServiceRoleClient();
  await ensureDefaultStatusesForOrganization({ organizationId: input.organizationId, supabase });

  // `ovld onboard` is interactive and may be re-run in the same repo. Reuse an existing
  // same-named project in this org rather than creating a duplicate.
  const { data: existing } = await supabase
    .from('projects')
    .select('id,name,organization_id')
    .eq('organization_id', input.organizationId)
    .eq('name', input.projectName)
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('projects')
    .insert({
      organization_id: input.organizationId,
      name: input.projectName,
      color: normalizeHexColor(DEFAULT_PROJECT_COLOR)
    })
    .select('id,name,organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create project.');
  }

  return data;
}

async function registerProjectResource(input: {
  organizationId: number;
  projectId: string;
  userId: string;
  directoryPath: string;
  deviceFingerprint: string;
  deviceHostname?: string;
  devicePlatform?: string;
}) {
  const supabase = createServiceRoleClient();
  const executionTargetId = await upsertDeviceFromProtocol(supabase, {
    organizationId: input.organizationId,
    userId: input.userId,
    deviceFingerprint: input.deviceFingerprint,
    hostname: input.deviceHostname ?? os.hostname(),
    port: null,
    platform: input.devicePlatform ?? null
  });

  if (!executionTargetId) {
    throw new Error('Failed to register execution target.');
  }

  await ensureProjectExecutionTarget(supabase, {
    projectId: input.projectId,
    organizationId: input.organizationId,
    userId: input.userId,
    executionTargetId
  });

  await assertCanManagePrimary(supabase, {
    userId: input.userId,
    projectId: input.projectId,
    executionTargetId
  });

  const shouldSetPrimary = await shouldAutoPrimary(supabase, {
    projectId: input.projectId,
    executionTargetId
  });

  if (shouldSetPrimary) {
    await clearTargetPrimary(supabase, input.projectId, executionTargetId);
  }

  const { data, error } = await (supabase as any)
    .from('project_resource_directories')
    .insert({
      user_id: input.userId,
      project_id: input.projectId,
      execution_target_id: executionTargetId,
      directory_path: input.directoryPath,
      label: null,
      is_primary: shouldSetPrimary
    })
    .select('id, is_primary, execution_target_id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await (supabase as any)
        .from('project_resource_directories')
        .select('id, is_primary, execution_target_id')
        .eq('project_id', input.projectId)
        .eq('execution_target_id', executionTargetId)
        .eq('directory_path', input.directoryPath)
        .maybeSingle();
      return {
        id: existing?.id ?? null,
        isPrimary: Boolean(existing?.is_primary),
        executionTargetId,
        alreadyRegistered: true
      };
    }
    throw new Error(error.message ?? 'Failed to register project directory.');
  }

  return {
    id: data.id as string,
    isPrimary: Boolean(data.is_primary),
    executionTargetId: data.execution_target_id as string,
    alreadyRegistered: false
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

    const organization = await resolveOrCreateOrganization({
      accessToken,
      organizationName: parsed.data.organizationName,
      userId: user.id
    });
    const project = await createProject({
      organizationId: organization.organizationId,
      projectName: parsed.data.projectName
    });
    const resource = await registerProjectResource({
      organizationId: organization.organizationId,
      projectId: project.id,
      userId: user.id,
      directoryPath: parsed.data.directoryPath,
      deviceFingerprint: parsed.data.deviceFingerprint,
      deviceHostname: parsed.data.deviceHostname,
      devicePlatform: parsed.data.devicePlatform
    });
    const ticket = await createOnboardingTicket({
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
    return internalErrorResponse(error);
  }
}
