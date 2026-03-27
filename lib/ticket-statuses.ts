import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];
type TicketPhase =
  | 'draft'
  | 'execute'
  | 'review'
  | 'complete'
  | 'blocked'
  | 'cancelled'
  | 'deliver';
type DbClient = SupabaseClient<Database>;
type StatusRow = {
  name: string;
  position: number;
  status_type: TicketStatusType;
};

function pickPreferredStatusName(statuses: StatusRow[], statusType: TicketStatusType): string {
  if (statuses.length === 0) {
    throw new Error(`No ${statusType} ticket status is configured.`);
  }

  if (statusType === 'draft') {
    return (
      statuses.find(status => status.name === 'draft')?.name ??
      statuses.find(status => status.name !== 'icebox' && status.name !== 'blocked')?.name ??
      statuses[0].name
    );
  }

  if (statusType === 'complete') {
    return (
      statuses.find(status => status.name === 'complete')?.name ??
      statuses.find(status => status.name !== 'cancelled')?.name ??
      statuses[0].name
    );
  }

  return statuses[0].name;
}

export async function resolveStatusTypeForName(
  supabase: DbClient,
  organizationId: number,
  statusName: string
): Promise<TicketStatusType | null> {
  const { data, error } = await supabase
    .from('ticket_statuses')
    .select('status_type')
    .eq('organization_id', organizationId)
    .eq('name', statusName)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.status_type ?? null;
}

export async function resolvePreferredStatusNameByType(
  supabase: DbClient,
  organizationId: number,
  statusType: TicketStatusType
): Promise<string> {
  const { data, error } = await supabase
    .from('ticket_statuses')
    .select('name,position,status_type')
    .eq('organization_id', organizationId)
    .eq('status_type', statusType)
    .order('position', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return pickPreferredStatusName((data ?? []) as StatusRow[], statusType);
}

export async function resolveNamedStatus(
  supabase: DbClient,
  organizationId: number,
  statusName: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ticket_statuses')
    .select('name')
    .eq('organization_id', organizationId)
    .eq('name', statusName)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.name ?? null;
}

export async function resolveStatusNameForPhase(
  supabase: DbClient,
  organizationId: number,
  phase: TicketPhase
): Promise<string> {
  switch (phase) {
    case 'draft':
    case 'execute':
    case 'review':
    case 'complete':
      return resolvePreferredStatusNameByType(supabase, organizationId, phase);
    case 'blocked':
    case 'cancelled': {
      const statusName = await resolveNamedStatus(supabase, organizationId, phase);
      if (!statusName) {
        throw new Error(`No "${phase}" status is configured.`);
      }
      return statusName;
    }
    case 'deliver':
      throw new Error('Use the deliver protocol instead of setting phase to "deliver".');
  }
}
