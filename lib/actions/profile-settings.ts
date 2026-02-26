'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

export async function fetchProfileCustomInstructions(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('custom_agent_instructions')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? 'Failed to load profile settings.');
  }

  return data?.custom_agent_instructions ?? null;
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
