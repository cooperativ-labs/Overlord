'use server';

import { revalidatePath } from 'next/cache';

import { createClientForRequest } from '@/supabase/utils/server';

export type ProjectTagDefinition = {
  id: string;
  project_id: string;
  key: string;
  label: string;
  description: string | null;
  color: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TicketTagAssignment = {
  tag_definition_id: string;
  source: string;
  applied_at: string;
  definition: ProjectTagDefinition;
};

export type EffectiveTicketTag = {
  tagDefinitionId: string;
  key: string;
  label: string;
  color: string | null;
  sources: string[];
};

export async function listProjectTagDefinitionsAction(
  projectId: string
): Promise<ProjectTagDefinition[]> {
  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('project_tag_definitions')
    .select('*')
    .eq('project_id', projectId)
    .order('label', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectTagDefinition[];
}

export async function createProjectTagDefinitionAction(
  projectId: string,
  input: { key: string; label: string; description?: string; color?: string }
): Promise<ProjectTagDefinition> {
  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('project_tag_definitions')
    .insert({
      project_id: projectId,
      key: input.key.toLowerCase().trim(),
      label: input.label.trim(),
      description: input.description?.trim() ?? null,
      color: input.color ?? null
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  revalidatePath('/projects', 'layout');
  return data as ProjectTagDefinition;
}

export async function updateProjectTagDefinitionAction(
  tagId: string,
  input: { label?: string; description?: string | null; color?: string | null; is_active?: boolean }
): Promise<ProjectTagDefinition> {
  const supabase = await createClientForRequest();
  const update: Record<string, unknown> = {};
  if (input.label !== undefined) update.label = input.label.trim();
  if ('description' in input) update.description = input.description ?? null;
  if ('color' in input) update.color = input.color ?? null;
  if (input.is_active !== undefined) update.is_active = input.is_active;

  const { data, error } = await supabase
    .from('project_tag_definitions')
    .update(update)
    .eq('id', tagId)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  revalidatePath('/projects', 'layout');
  return data as ProjectTagDefinition;
}

export async function getTicketTagsAction(ticketId: string): Promise<EffectiveTicketTag[]> {
  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('ticket_tag_assignments')
    .select('tag_definition_id, source, applied_at, project_tag_definitions(*)')
    .eq('ticket_id', ticketId);

  if (error) throw new Error(error.message);

  const byTagId = new Map<string, EffectiveTicketTag>();
  for (const row of data ?? []) {
    const def = (row as unknown as { project_tag_definitions: ProjectTagDefinition | null })
      .project_tag_definitions;
    if (!def || !def.is_active) continue;

    const existing = byTagId.get(row.tag_definition_id);
    if (existing) {
      existing.sources.push(row.source);
    } else {
      byTagId.set(row.tag_definition_id, {
        tagDefinitionId: row.tag_definition_id,
        key: def.key,
        label: def.label,
        color: def.color,
        sources: [row.source]
      });
    }
  }

  return Array.from(byTagId.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function getTicketTagsBatchAction(
  ticketIds: string[]
): Promise<Record<string, EffectiveTicketTag[]>> {
  if (ticketIds.length === 0) return {};

  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('ticket_tag_assignments')
    .select('ticket_id, tag_definition_id, source, project_tag_definitions(*)')
    .in('ticket_id', ticketIds);

  if (error) throw new Error(error.message);

  const result: Record<string, Map<string, EffectiveTicketTag>> = {};
  for (const row of data ?? []) {
    const def = (row as unknown as { project_tag_definitions: ProjectTagDefinition | null })
      .project_tag_definitions;
    if (!def || !def.is_active) continue;

    if (!result[row.ticket_id]) result[row.ticket_id] = new Map();
    const map = result[row.ticket_id];
    const existing = map.get(row.tag_definition_id);
    if (existing) {
      existing.sources.push(row.source);
    } else {
      map.set(row.tag_definition_id, {
        tagDefinitionId: row.tag_definition_id,
        key: def.key,
        label: def.label,
        color: def.color,
        sources: [row.source]
      });
    }
  }

  return Object.fromEntries(
    Object.entries(result).map(([tid, map]) => [
      tid,
      Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
    ])
  );
}

export async function applyUserTagToTicketAction(
  ticketId: string,
  tagDefinitionId: string
): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { error } = await supabase.from('ticket_tag_assignments').upsert(
    {
      ticket_id: ticketId,
      tag_definition_id: tagDefinitionId,
      source: 'user',
      applied_by: user?.id ?? null
    },
    { onConflict: 'ticket_id,tag_definition_id,source' }
  );

  if (error) throw new Error(error.message);

  // Remove any suppression so user explicitly re-enabling doesn't stay suppressed.
  const { error: suppressionError } = await supabase
    .from('ticket_tag_engine_suppressions')
    .delete()
    .eq('ticket_id', ticketId)
    .eq('tag_definition_id', tagDefinitionId);
  if (suppressionError) throw new Error(suppressionError.message);

  revalidatePath('/u', 'layout');
  revalidatePath('/projects', 'layout');
}

export async function removeUserTagFromTicketAction(
  ticketId: string,
  tagDefinitionId: string
): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Check if there's an engine assignment (if so, create a suppression).
  const { data: engineRow } = await supabase
    .from('ticket_tag_assignments')
    .select('tag_definition_id')
    .eq('ticket_id', ticketId)
    .eq('tag_definition_id', tagDefinitionId)
    .eq('source', 'engine')
    .maybeSingle();

  if (engineRow) {
    // Remove engine assignment and add suppression.
    const { error: removeEngineError } = await supabase
      .from('ticket_tag_assignments')
      .delete()
      .eq('ticket_id', ticketId)
      .eq('tag_definition_id', tagDefinitionId)
      .eq('source', 'engine');
    if (removeEngineError) throw new Error(removeEngineError.message);

    const { error: suppressionError } = await supabase
      .from('ticket_tag_engine_suppressions')
      .upsert(
        {
          ticket_id: ticketId,
          tag_definition_id: tagDefinitionId,
          suppressed_by: user?.id ?? null,
          reason: 'user_removed_engine_tag'
        },
        { onConflict: 'ticket_id,tag_definition_id' }
      );
    if (suppressionError) throw new Error(suppressionError.message);
  }

  // Always remove the user assignment.
  const { error: removeUserError } = await supabase
    .from('ticket_tag_assignments')
    .delete()
    .eq('ticket_id', ticketId)
    .eq('tag_definition_id', tagDefinitionId)
    .eq('source', 'user');
  if (removeUserError) throw new Error(removeUserError.message);

  revalidatePath('/u', 'layout');
  revalidatePath('/projects', 'layout');
}
