'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

export type SshServerProfile = Database['public']['Tables']['ssh_server_profiles']['Row'];

export type SshServerProfileSummary = Pick<
  SshServerProfile,
  'id' | 'name' | 'host' | 'port' | 'username' | 'working_directory' | 'last_tested_at' | 'created_at'
>;

export type UpsertSshServerInput = {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKey: string;
  workingDirectory: string;
};

async function getOrgId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .order('id', { ascending: true })
    .limit(1)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'No organization found.');
  return data.id;
}

export async function listSshServerProfilesAction(): Promise<SshServerProfileSummary[]> {
  const supabase = await createClient();
  const orgId = await getOrgId(supabase);

  const { data, error } = await supabase
    .from('ssh_server_profiles')
    .select('id, name, host, port, username, working_directory, last_tested_at, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function upsertSshServerProfileAction(input: UpsertSshServerInput): Promise<SshServerProfileSummary> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const orgId = await getOrgId(supabase);

  const payload = {
    organization_id: orgId,
    created_by: user.id,
    name: input.name.trim(),
    host: input.host.trim(),
    port: input.port,
    username: input.username.trim(),
    private_key: input.privateKey,
    working_directory: input.workingDirectory.trim() || '/home',
    updated_at: new Date().toISOString(),
  };

  let result;

  if (input.id) {
    const { data, error } = await supabase
      .from('ssh_server_profiles')
      .update(payload)
      .eq('id', input.id)
      .eq('created_by', user.id)
      .select('id, name, host, port, username, working_directory, last_tested_at, created_at')
      .single();
    if (error) throw new Error(error.message);
    result = data;
  } else {
    const { data, error } = await supabase
      .from('ssh_server_profiles')
      .insert(payload)
      .select('id, name, host, port, username, working_directory, last_tested_at, created_at')
      .single();
    if (error) throw new Error(error.message);
    result = data;
  }

  revalidatePath('/');
  return result;
}

export async function deleteSshServerProfileAction(id: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { error } = await supabase
    .from('ssh_server_profiles')
    .delete()
    .eq('id', id)
    .eq('created_by', user.id);

  if (error) throw new Error(error.message);
  revalidatePath('/');
}

export async function markSshServerTestedAction(id: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  await supabase
    .from('ssh_server_profiles')
    .update({ last_tested_at: new Date().toISOString() })
    .eq('id', id)
    .eq('created_by', user.id);
}

/** Fetches the full profile row including private_key — server-only. */
export async function getSshServerProfileWithKeyAction(id: string): Promise<SshServerProfile> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('ssh_server_profiles')
    .select('*')
    .eq('id', id)
    .eq('created_by', user.id)
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Server profile not found.');
  return data;
}
