import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { createServiceRoleClient } from '@/supabase/utils/service-role';

/**
 * RLS + ownership behavior for project_resource_directories (Phase 0).
 *
 * Requires a running local Supabase stack (http://127.0.0.1:54321). Verifies the
 * target-ownership write predicate enforced by
 * `can_manage_project_resource_directory` and the broadened org-member SELECT
 * policy:
 *   - Personal target (owner = userA): userB cannot write, but can still SELECT.
 *   - Org-owned target (owner = null): userB (MANAGER) can write; a VIEWER cannot.
 *   - Primary uniqueness is per (project, target) regardless of who owns the rows.
 */

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// Well-known supabase local "anon" key (demo signing key) unless overridden.
const LOCAL_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const USER_A = '21111111-1111-4111-8111-111111111101';
const USER_B = '21111111-1111-4111-8111-111111111102';
const PASSWORD = 'test-password-123!';

async function userClient(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.SUPABASE_URL ?? LOCAL_SUPABASE_URL,
    LOCAL_PUBLISHABLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

describe('project_resource_directories ownership RLS', () => {
  let service: ReturnType<typeof createServiceRoleClient>;
  let orgId = 0;
  let projectId = '';
  let targetId = '';

  beforeAll(async () => {
    process.env.SUPABASE_URL ??= LOCAL_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= LOCAL_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY ??= LOCAL_SECRET_KEY;
    service = createServiceRoleClient();

    for (const [id, email] of [
      [USER_A, 'rls-owner-a@test.local'],
      [USER_B, 'rls-owner-b@test.local']
    ] as const) {
      await service.auth.admin.createUser({
        id,
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: {}
      });
    }
  });

  afterAll(async () => {
    await service?.auth.admin.deleteUser(USER_A);
    await service?.auth.admin.deleteUser(USER_B);
  });

  beforeEach(async () => {
    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: 'Ownership RLS Org' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    // userA = ADMIN, userB = MANAGER (a project editor).
    await service.from('members').insert([
      { organization_id: orgId, user_id: USER_A, role: 'ADMIN' },
      { organization_id: orgId, user_id: USER_B, role: 'MANAGER' }
    ]);

    const { data: project, error: projectError } = await service
      .from('projects')
      .insert({ organization_id: orgId, name: 'RLS Project', color: '#123456' })
      .select('id')
      .single();
    if (projectError) throw projectError;
    projectId = project.id;

    const { data: target, error: targetError } = await service
      .from('execution_targets')
      .insert({
        device_fingerprint: `rls-target-${orgId}`,
        host: 'rls-host',
        transport: 'local',
        is_placeholder: false
      })
      .select('id')
      .single();
    if (targetError) throw targetError;
    targetId = target.id;

    await service.from('project_execution_targets').insert({
      project_id: projectId,
      execution_target_id: targetId,
      organization_id: orgId,
      added_by: USER_A
    });
  });

  afterEach(async () => {
    await service.from('project_resource_directories').delete().eq('project_id', projectId);
    await service.from('project_execution_targets').delete().eq('project_id', projectId);
    await service
      .from('organization_execution_targets')
      .delete()
      .eq('execution_target_id', targetId);
    await service.from('execution_targets').delete().eq('id', targetId);
    await service.from('projects').delete().eq('id', projectId);
    await service.from('members').delete().eq('organization_id', orgId);
    await service.from('organizations').delete().eq('id', orgId);
  });

  it('personal target: only the owner may write; other members may still read', async () => {
    await service.from('organization_execution_targets').insert({
      organization_id: orgId,
      execution_target_id: targetId,
      label: 'personal-target',
      owner_user_id: USER_A
    });

    const clientA = await userClient('rls-owner-a@test.local');
    const clientB = await userClient('rls-owner-b@test.local');

    // userA (owner) can insert a primary directory.
    const insertA = await clientA.from('project_resource_directories').insert({
      user_id: USER_A,
      project_id: projectId,
      execution_target_id: targetId,
      directory_path: '/home/a/project',
      is_primary: true
    });
    expect(insertA.error).toBeNull();

    // userB (member, not owner) cannot insert on a personal target.
    const insertB = await clientB.from('project_resource_directories').insert({
      user_id: USER_B,
      project_id: projectId,
      execution_target_id: targetId,
      directory_path: '/home/b/project',
      is_primary: false
    });
    expect(insertB.error).not.toBeNull();

    // ...but userB can SELECT the shared primary.
    const readB = await clientB
      .from('project_resource_directories')
      .select('directory_path, is_primary')
      .eq('project_id', projectId);
    expect(readB.error).toBeNull();
    expect(readB.data).toHaveLength(1);
    expect(readB.data?.[0]?.is_primary).toBe(true);
  });

  it('org-owned target: a project editor (MANAGER) may write', async () => {
    await service.from('organization_execution_targets').insert({
      organization_id: orgId,
      execution_target_id: targetId,
      label: 'org-target',
      owner_user_id: null
    });

    const clientB = await userClient('rls-owner-b@test.local');
    const insertB = await clientB.from('project_resource_directories').insert({
      user_id: USER_B,
      project_id: projectId,
      execution_target_id: targetId,
      directory_path: '/srv/project',
      is_primary: true
    });
    expect(insertB.error).toBeNull();
  });

  it('org-owned target: a VIEWER cannot write but can read', async () => {
    await service
      .from('members')
      .update({ role: 'VIEWER' })
      .eq('organization_id', orgId)
      .eq('user_id', USER_B);
    await service.from('organization_execution_targets').insert({
      organization_id: orgId,
      execution_target_id: targetId,
      label: 'org-target',
      owner_user_id: null
    });
    await service.from('project_resource_directories').insert({
      user_id: USER_A,
      project_id: projectId,
      execution_target_id: targetId,
      directory_path: '/srv/project',
      is_primary: true
    });

    const clientB = await userClient('rls-owner-b@test.local');
    const insertB = await clientB.from('project_resource_directories').insert({
      user_id: USER_B,
      project_id: projectId,
      execution_target_id: targetId,
      directory_path: '/srv/other',
      is_primary: false
    });
    expect(insertB.error).not.toBeNull();

    const readB = await clientB
      .from('project_resource_directories')
      .select('id')
      .eq('project_id', projectId);
    expect(readB.error).toBeNull();
    expect(readB.data).toHaveLength(1);
  });

  it('primary uniqueness is per (project, target) regardless of row author', async () => {
    await service.from('organization_execution_targets').insert({
      organization_id: orgId,
      execution_target_id: targetId,
      label: 'org-target',
      owner_user_id: null
    });

    // Two directories from two different authors; only one may be primary.
    await service.from('project_resource_directories').insert({
      user_id: USER_A,
      project_id: projectId,
      execution_target_id: targetId,
      directory_path: '/srv/a',
      is_primary: true
    });

    const second = await service.from('project_resource_directories').insert({
      user_id: USER_B,
      project_id: projectId,
      execution_target_id: targetId,
      directory_path: '/srv/b',
      is_primary: true
    });
    // Violates project_resource_directories_primary_target_uidx.
    expect(second.error?.code).toBe('23505');
  });
});
