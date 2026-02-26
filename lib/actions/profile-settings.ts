'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

export async function fetchProfileSettings(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{
  custom_agent_instructions: string | null;
  default_project_id: string | null;
} | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('custom_agent_instructions, default_project_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? 'Failed to load profile settings.');
  }

  return data;
}

export async function fetchProfileCustomInstructions(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<string | null> {
  const data = await fetchProfileSettings(supabase, userId);
  return data?.custom_agent_instructions ?? null;
}

export async function upsertProfileDefaultProject(
  supabase: SupabaseClient<Database>,
  userId: string,
  defaultProjectId: string | null
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        default_project_id: defaultProjectId
      },
      { onConflict: 'id' }
    )
    .select('default_project_id')
    .single();

  if (error) {
    throw new Error(error.message ?? 'Failed to save profile settings.');
  }

  return data?.default_project_id ?? defaultProjectId;
}

export async function upsertProfileCustomInstructions(
  supabase: SupabaseClient<Database>,
  userId: string,
  customAgentInstructions: string
): Promise<string> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        custom_agent_instructions: customAgentInstructions
      },
      { onConflict: 'id' }
    )
    .select('custom_agent_instructions')
    .single();

  if (error) {
    throw new Error(error.message ?? 'Failed to save profile settings.');
  }

  return data?.custom_agent_instructions ?? customAgentInstructions;
}

export async function getCustomInstructionsAction(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const instructions = await fetchProfileCustomInstructions(supabase, user.id);
  return instructions ?? '';
}

export async function saveCustomInstructionsAction(
  customAgentInstructions: string
): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  return upsertProfileCustomInstructions(supabase, user.id, customAgentInstructions);
}

export async function getDefaultProjectAction(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const settings = await fetchProfileSettings(supabase, user.id);
  return settings?.default_project_id ?? null;
}

export async function saveDefaultProjectAction(
  defaultProjectId: string | null
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  return upsertProfileDefaultProject(supabase, user.id, defaultProjectId);
}
