'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createClientForRequest } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

export async function fetchProfileSettings(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{
  ai_title_generation: boolean | null;
  custom_agent_instructions: string | null;
  default_project_id: string | null;
  editor_scheme: string | null;
  preferences: unknown;
} | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'ai_title_generation, custom_agent_instructions, default_project_id, editor_scheme, preferences'
    )
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

export async function upsertProfileEditorScheme(
  supabase: SupabaseClient<Database>,
  userId: string,
  editorScheme: string
): Promise<string> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        editor_scheme: editorScheme
      },
      { onConflict: 'id' }
    )
    .select('editor_scheme')
    .single();

  if (error) {
    throw new Error(error.message ?? 'Failed to save profile settings.');
  }

  return data?.editor_scheme ?? editorScheme;
}

export async function getCustomInstructionsAction(): Promise<string> {
  const supabase = await createClientForRequest();
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
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  return upsertProfileCustomInstructions(supabase, user.id, customAgentInstructions);
}

export async function getEditorSchemeAction(): Promise<string | null> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const settings = await fetchProfileSettings(supabase, user.id);
  return settings?.editor_scheme ?? null;
}

export async function saveEditorSchemeAction(editorScheme: string): Promise<string> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  return upsertProfileEditorScheme(supabase, user.id, editorScheme);
}

export async function getDefaultProjectAction(): Promise<string | null> {
  const supabase = await createClientForRequest();
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
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  return upsertProfileDefaultProject(supabase, user.id, defaultProjectId);
}

export async function getAiTitleGenerationAction(): Promise<boolean> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const settings = await fetchProfileSettings(supabase, user.id);
  return settings?.ai_title_generation ?? true;
}

export async function saveAiTitleGenerationAction(enabled: boolean): Promise<boolean> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        ai_title_generation: enabled
      },
      { onConflict: 'id' }
    )
    .select('ai_title_generation')
    .single();

  if (error) {
    throw new Error(error.message ?? 'Failed to save AI title generation preference.');
  }

  return data?.ai_title_generation ?? enabled;
}
