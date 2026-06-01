import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProjectSshAuthMethod } from '@/lib/actions/project-types';
import type { Database } from '@/types/database.types';

type AnySupabase = SupabaseClient<any>;

export type ExecutionTargetUpsertInput = {
  organizationId: number;
  userId: string;
  deviceFingerprint: string;
  hostname?: string | null;
  port?: number | null;
  platform?: string | null;
};

export type SshExecutionTargetInput = {
  organizationId: number;
  userId: string;
  host: string;
  port?: number | null;
  username: string;
  authMethod?: ProjectSshAuthMethod | null;
  privateKeyPath?: string | null;
  label?: string | null;
  hostKeyFingerprint?: string | null;
  /**
   * Ownership for the target's org association when first created. `undefined`
   * defaults to personal (the registering user); pass `null` to make it
   * organization-owned.
   */
  ownerUserId?: string | null;
};

function db(supabase: SupabaseClient<Database>): AnySupabase {
  return supabase as unknown as AnySupabase;
}

function normalizePort(port: number | null | undefined): number {
  return typeof port === 'number' && Number.isFinite(port) ? port : 22;
}

function normalizeAuthMethod(
  method: ProjectSshAuthMethod | null | undefined
): ProjectSshAuthMethod {
  return method && ['agent', 'key', 'tailscale'].includes(method) ? method : 'agent';
}

async function findSshPlaceholderId(
  supabase: SupabaseClient<Database>,
  input: { host: string; port?: number | null }
): Promise<string | null> {
  const host = input.host.trim();
  if (!host) return null;

  const baseQuery = () =>
    db(supabase)
      .from('execution_targets')
      .select('id')
      .eq('is_placeholder', true)
      .eq('host', host)
      .eq('transport', 'ssh');

  if (typeof input.port === 'number') {
    const { data } = await baseQuery().eq('port', normalizePort(input.port)).maybeSingle();
    return data?.id ?? null;
  }

  const { data: matches } = await baseQuery();
  if (!matches || matches.length !== 1) return null;
  return matches[0]?.id ?? null;
}

async function generateLabel(
  supabase: SupabaseClient<Database>,
  organizationId: number,
  hostname: string | null | undefined,
  platform: string | null | undefined
): Promise<string> {
  const { data } = await db(supabase).rpc('generate_execution_target_label', {
    org_id: organizationId,
    hostname: hostname ?? '',
    platform: platform ?? ''
  });
  return typeof data === 'string' && data.length > 0 ? data : 'target';
}

async function ensureAssociations(
  supabase: SupabaseClient<Database>,
  input: {
    organizationId: number;
    userId: string;
    executionTargetId: string;
    label?: string | null;
    defaultUsername?: string | null;
    /**
     * Per-org owner to set when the org↔target association is first created.
     * Ignored on conflict — ownership only changes via
     * `setExecutionTargetOwnershipAction`. `undefined`/`null` => org-owned.
     */
    ownerUserId?: string | null;
  }
): Promise<void> {
  const { data: existingOrgTarget } = await db(supabase)
    .from('organization_execution_targets')
    .select('label')
    .eq('organization_id', input.organizationId)
    .eq('execution_target_id', input.executionTargetId)
    .maybeSingle();

  const targetLabel =
    input.label?.trim() ||
    existingOrgTarget?.label ||
    (await generateLabel(supabase, input.organizationId, input.defaultUsername, 'target'));

  if (existingOrgTarget) {
    // Refresh the label/added_by but never overwrite ownership on re-registration.
    await db(supabase)
      .from('organization_execution_targets')
      .update({ label: targetLabel, added_by: input.userId })
      .eq('organization_id', input.organizationId)
      .eq('execution_target_id', input.executionTargetId);
  } else {
    await db(supabase)
      .from('organization_execution_targets')
      .insert({
        organization_id: input.organizationId,
        execution_target_id: input.executionTargetId,
        label: targetLabel,
        added_by: input.userId,
        owner_user_id: input.ownerUserId ?? null
      });
  }

  await db(supabase)
    .from('user_execution_targets')
    .upsert(
      {
        user_id: input.userId,
        execution_target_id: input.executionTargetId,
        default_username: input.defaultUsername ?? null,
        access_status: 'active',
        last_connected_at: new Date().toISOString()
      },
      { onConflict: 'user_id,execution_target_id' }
    );
}

export async function ensureProjectExecutionTarget(
  supabase: SupabaseClient<Database>,
  input: {
    projectId: string;
    organizationId: number;
    userId: string;
    executionTargetId: string;
  }
): Promise<void> {
  await db(supabase).from('project_execution_targets').upsert(
    {
      project_id: input.projectId,
      execution_target_id: input.executionTargetId,
      organization_id: input.organizationId,
      added_by: input.userId
    },
    { onConflict: 'project_id,execution_target_id' }
  );
}

export async function upsertExecutionTargetFromProtocol(
  supabase: SupabaseClient<Database>,
  input: ExecutionTargetUpsertInput
): Promise<string | null> {
  const fingerprint = input.deviceFingerprint.trim();
  if (!fingerprint) return null;

  const now = new Date().toISOString();
  const host = input.hostname?.trim() ?? '';
  const transport = input.platform === 'ssh' ? 'ssh' : 'local';

  let targetId: string | null;
  const { data: existing } = await db(supabase)
    .from('execution_targets')
    .select('id')
    .eq('device_fingerprint', fingerprint)
    .maybeSingle();

  if (existing?.id) {
    targetId = existing.id;
    await db(supabase)
      .from('execution_targets')
      .update({
        host,
        platform: input.platform ?? null,
        transport,
        last_seen_at: now,
        is_placeholder: false,
        placeholder_key: null
      })
      .eq('id', targetId);
  } else {
    const placeholderId = host
      ? await findSshPlaceholderId(supabase, { host, port: input.port })
      : null;

    if (placeholderId) {
      targetId = placeholderId;
      await db(supabase)
        .from('execution_targets')
        .update({
          device_fingerprint: fingerprint,
          is_placeholder: false,
          placeholder_key: null,
          host,
          platform: input.platform ?? null,
          transport,
          last_seen_at: now
        })
        .eq('id', targetId);
    } else {
      const label = await generateLabel(supabase, input.organizationId, host, input.platform);
      const { data: inserted, error } = await db(supabase)
        .from('execution_targets')
        .insert({
          device_fingerprint: fingerprint,
          is_placeholder: false,
          host,
          port: 22,
          name: label,
          transport,
          platform: input.platform ?? null,
          last_seen_at: now
        })
        .select('id')
        .single();

      if (error) {
        const { data: retry } = await db(supabase)
          .from('execution_targets')
          .select('id')
          .eq('device_fingerprint', fingerprint)
          .maybeSingle();
        targetId = retry?.id ?? null;
      } else {
        targetId = inserted?.id ?? null;
      }
    }
  }

  if (!targetId) return null;

  await ensureAssociations(supabase, {
    organizationId: input.organizationId,
    userId: input.userId,
    executionTargetId: targetId,
    defaultUsername: null,
    // A self-registered machine (laptop running `ovld`) defaults to personal.
    ownerUserId: input.userId
  });

  return targetId;
}

export async function upsertSshExecutionTarget(
  supabase: SupabaseClient<Database>,
  input: SshExecutionTargetInput
): Promise<string | null> {
  const host = input.host.trim();
  const username = input.username.trim();
  if (!host || !username) return null;

  const port = normalizePort(input.port);
  const placeholderKey = `ssh:${host}:${port}`;
  const authMethod = normalizeAuthMethod(input.authMethod);
  const label =
    input.label?.trim() || (await generateLabel(supabase, input.organizationId, host, 'ssh'));
  const now = new Date().toISOString();

  const { data: existing } = await db(supabase)
    .from('execution_targets')
    .select('id')
    .eq('placeholder_key', placeholderKey)
    .maybeSingle();

  let targetId = existing?.id ?? null;
  if (!targetId) {
    const { data: inserted, error } = await db(supabase)
      .from('execution_targets')
      .insert({
        placeholder_key: placeholderKey,
        is_placeholder: true,
        host,
        port,
        name: label,
        transport: 'ssh',
        platform: 'ssh',
        last_seen_at: now
      })
      .select('id')
      .single();
    if (error || !inserted) return null;
    targetId = inserted.id;
  } else {
    await db(supabase)
      .from('execution_targets')
      .update({
        host,
        port,
        name: label,
        transport: 'ssh',
        platform: 'ssh',
        last_seen_at: now
      })
      .eq('id', targetId);
  }

  await ensureAssociations(supabase, {
    organizationId: input.organizationId,
    userId: input.userId,
    executionTargetId: targetId,
    label,
    defaultUsername: username,
    // SSH targets default to personal unless the caller opts into org-owned.
    ownerUserId: input.ownerUserId === undefined ? input.userId : input.ownerUserId
  });

  await db(supabase)
    .from('execution_target_ssh_credentials')
    .upsert(
      {
        execution_target_id: targetId,
        user_id: input.userId,
        username,
        auth_method: authMethod,
        private_key_path: input.privateKeyPath?.trim() || null,
        host_key_fingerprint: input.hostKeyFingerprint?.trim() || null
      },
      { onConflict: 'execution_target_id,user_id,username,auth_method' }
    );

  return targetId;
}

export async function findExecutionTargetByFingerprint(
  supabase: SupabaseClient<Database>,
  input: {
    organizationId: number;
    userId: string;
    deviceFingerprint: string;
  }
): Promise<string | null> {
  const fingerprint = input.deviceFingerprint.trim();
  if (!fingerprint) return null;

  const { data } = await db(supabase)
    .from('execution_targets')
    .select(
      'id, organization_execution_targets!inner(organization_id), user_execution_targets!inner(user_id)'
    )
    .eq('device_fingerprint', fingerprint)
    .eq('organization_execution_targets.organization_id', input.organizationId)
    .eq('user_execution_targets.user_id', input.userId)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * Resolve a user's execution target by fingerprint without scoping to an org.
 *
 * The runner is org-agnostic (G3): `claim-execution` returns work from any org
 * the user belongs to that shares the target, so the post-claim lifecycle
 * (`complete`/`fail`) must not be pinned to the token's default org — otherwise
 * a target claimed for org B but resolved with a default of org A would 404.
 * A target belongs to a user via `user_execution_targets`, which is the only
 * identity these calls need; the caller still gates the request row by
 * `requested_by` and `claimed_by_execution_target_id`.
 */
export async function findUserExecutionTargetByFingerprint(
  supabase: SupabaseClient<Database>,
  input: {
    userId: string;
    deviceFingerprint: string;
  }
): Promise<string | null> {
  const fingerprint = input.deviceFingerprint.trim();
  if (!fingerprint) return null;

  const { data } = await db(supabase)
    .from('execution_targets')
    .select('id, user_execution_targets!inner(user_id)')
    .eq('device_fingerprint', fingerprint)
    .eq('user_execution_targets.user_id', input.userId)
    .maybeSingle();

  return data?.id ?? null;
}
