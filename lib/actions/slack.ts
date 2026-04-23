'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

type SlackWorkspaceRow = Database['public']['Tables']['slack_workspaces']['Row'];

export type SlackWorkspace = Pick<
  SlackWorkspaceRow,
  | 'id'
  | 'team_id'
  | 'team_name'
  | 'slack_user_id'
  | 'default_project_id'
  | 'default_status'
  | 'default_priority'
  | 'default_execution_target'
  | 'include_context'
  | 'restrict_to_owner'
  | 'created_at'
>;

export async function getSlackWorkspacesAction(): Promise<SlackWorkspace[]> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('slack_workspaces')
    .select(
      'id,team_id,team_name,slack_user_id,default_project_id,default_status,default_priority,default_execution_target,include_context,restrict_to_owner,created_at'
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[slack] getSlackWorkspacesAction:', error.message);
    return [];
  }

  return data ?? [];
}

export type UpdateSlackWorkspaceInput = Partial<{
  default_project_id: string | null;
  default_status: string;
  default_priority: string;
  default_execution_target: 'agent' | 'human';
  include_context: boolean;
  restrict_to_owner: boolean;
}>;

export async function updateSlackWorkspaceAction(
  workspaceId: string,
  input: UpdateSlackWorkspaceInput
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  const { error } = await supabase
    .from('slack_workspaces')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', workspaceId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/');
  return {};
}

export async function disconnectSlackWorkspaceAction(
  workspaceId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  const { error } = await supabase
    .from('slack_workspaces')
    .delete()
    .eq('id', workspaceId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/');
  return {};
}

export async function getProjectSlackDefaultStatusAction(
  projectId: string
): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('slack_default_status')
    .eq('id', projectId)
    .maybeSingle();

  if (error || !data) return null;
  return data.slack_default_status;
}

export async function updateProjectSlackDefaultStatusAction(
  projectId: string,
  status: string | null
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  const { error } = await supabase
    .from('projects')
    .update({ slack_default_status: status })
    .eq('id', projectId);

  if (error) return { error: error.message };

  revalidatePath('/');
  return {};
}
