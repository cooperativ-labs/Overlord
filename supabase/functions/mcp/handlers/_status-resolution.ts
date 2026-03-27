import { type SupabaseClient } from '@supabase/supabase-js';

type TicketStatusType = 'draft' | 'execute' | 'review' | 'complete';
type TicketPhase = TicketStatusType | 'blocked' | 'cancelled' | 'deliver';
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
  supabase: SupabaseClient,
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

  return ((data as { status_type?: TicketStatusType } | null)?.status_type ??
    null) as TicketStatusType | null;
}

export async function resolvePreferredStatusNameByType(
  supabase: SupabaseClient,
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
  supabase: SupabaseClient,
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

  return ((data as { name?: string } | null)?.name ?? null) as string | null;
}

export async function resolveStatusNameForPhase(
  supabase: SupabaseClient,
  organizationId: number,
  phase: TicketPhase
): Promise<string> {
  switch (phase) {
    case 'draft':
    case 'execute':
    case 'review':
    case 'complete':
      return await resolvePreferredStatusNameByType(supabase, organizationId, phase);
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
