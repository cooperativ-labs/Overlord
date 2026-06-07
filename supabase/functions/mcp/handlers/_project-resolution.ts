// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProjectRow = {
  id: string;
  name: string;
  organization_id: number;
};

export async function resolveProjectIdOrName(
  supabase: SupabaseClient,
  organizationId: number,
  projectIdOrName: string
): Promise<ProjectRow | null> {
  const trimmed = projectIdOrName.trim();
  if (!trimmed) return null;

  if (UUID_RE.test(trimmed)) {
    const { data } = await supabase
      .from('projects')
      .select('id, name, organization_id')
      .eq('id', trimmed)
      .eq('organization_id', organizationId)
      .maybeSingle();
    return (data as ProjectRow | null) ?? null;
  }

  const { data } = await supabase
    .from('projects')
    .select('id, name, organization_id')
    .eq('organization_id', organizationId)
    .ilike('name', trimmed)
    .limit(1)
    .maybeSingle();
  return (data as ProjectRow | null) ?? null;
}
