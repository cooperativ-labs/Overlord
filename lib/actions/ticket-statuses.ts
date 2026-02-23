'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

const allowedStatusTypes: TicketStatusType[] = ['draft', 'execute', 'review', 'complete'];
const statusNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeStatusType(statusType: string): TicketStatusType {
  if (allowedStatusTypes.includes(statusType as TicketStatusType)) {
    return statusType as TicketStatusType;
  }

  throw new Error('Invalid status type.');
}

function normalizeStatusName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (!normalized) {
    throw new Error('Status name is required.');
  }
  if (!statusNamePattern.test(normalized)) {
    throw new Error(
      'Status name must use lowercase letters, numbers, and optional hyphens (e.g. qa-ready).'
    );
  }
  return normalized;
}

export async function createTicketStatusAction(input: {
  organizationId: number;
  projectId: string;
  name: string;
  statusType: TicketStatusType;
}) {
  const organizationId = Number(input.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw new Error('Invalid organization.');
  }

  const projectId = input.projectId.trim();
  if (!projectId) {
    throw new Error('Project is required.');
  }

  const name = normalizeStatusName(input.name);
  const statusType = normalizeStatusType(input.statusType);

  const supabase = await createClient();
  const { data: tailRows, error: tailError } = await supabase
    .from('ticket_statuses')
    .select('position')
    .eq('organization_id', organizationId)
    .order('position', { ascending: false })
    .limit(1);

  if (tailError) {
    throw new Error(tailError.message);
  }

  const nextPosition = (tailRows?.[0]?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from('ticket_statuses')
    .insert({
      organization_id: organizationId,
      name,
      position: nextPosition,
      status_type: statusType,
      is_default: false
    })
    .select('name,status_type,position,is_default')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      throw new Error('A status with this name already exists.');
    }

    throw new Error(error?.message ?? 'Failed to create status.');
  }

  revalidatePath('/u');
  revalidatePath(`/${organizationId}`);
  revalidatePath(`/${organizationId}/projects/${projectId}`);

  return {
    name: data.name,
    statusType: data.status_type,
    position: data.position,
    isDefault: data.is_default
  };
}
