'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

const allowedStatusTypes: TicketStatusType[] = ['draft', 'execute', 'review', 'complete'];
const requiredStatusTypes: TicketStatusType[] = ['draft', 'execute', 'review'];
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
  const letterCount = normalized.match(/[a-z]/g)?.length ?? 0;
  if (letterCount < 3) {
    throw new Error('Status name must include at least three letters.');
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

export async function deleteTicketStatusAction(input: {
  organizationId: number;
  projectId: string;
  name: string;
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

  const supabase = await createClient();
  const { data: targetStatus, error: targetStatusError } = await supabase
    .from('ticket_statuses')
    .select('status_type')
    .eq('organization_id', organizationId)
    .eq('name', name)
    .single();

  if (targetStatusError || !targetStatus) {
    throw new Error(targetStatusError?.message ?? 'Status not found.');
  }

  if (requiredStatusTypes.includes(targetStatus.status_type)) {
    const { count, error: countError } = await supabase
      .from('ticket_statuses')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status_type', targetStatus.status_type);

    if (countError) {
      throw new Error(countError.message ?? 'Failed to validate status requirements.');
    }

    if ((count ?? 0) <= 1) {
      throw new Error(
        `At least one ${targetStatus.status_type} status is required. Add another one before deleting this status.`
      );
    }
  }

  const { error } = await supabase
    .from('ticket_statuses')
    .delete()
    .eq('organization_id', organizationId)
    .eq('name', name);

  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'This status still has tickets. Change those tickets to a different status before removing it.'
      );
    }

    throw new Error(error.message ?? 'Failed to delete status.');
  }

  revalidatePath('/u');
  revalidatePath(`/${organizationId}`);
  revalidatePath(`/${organizationId}/projects/${projectId}`);
}

export async function updateTicketStatusNameAction(input: {
  organizationId: number;
  projectId: string;
  currentName: string;
  nextName: string;
}) {
  const organizationId = Number(input.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw new Error('Invalid organization.');
  }

  const projectId = input.projectId.trim();
  if (!projectId) {
    throw new Error('Project is required.');
  }

  const currentName = normalizeStatusName(input.currentName);
  const nextName = normalizeStatusName(input.nextName);

  if (currentName === nextName) {
    return;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ticket_statuses')
    .update({ name: nextName })
    .eq('organization_id', organizationId)
    .eq('name', currentName)
    .select('name,status_type,position,is_default')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      throw new Error('A status with this name already exists.');
    }
    throw new Error(error?.message ?? 'Failed to update status name.');
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

export async function reorderTicketStatusesAction(input: {
  organizationId: number;
  projectId: string;
  orderedNames: string[];
}) {
  const organizationId = Number(input.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw new Error('Invalid organization.');
  }

  const projectId = input.projectId.trim();
  if (!projectId) {
    throw new Error('Project is required.');
  }

  if (!Array.isArray(input.orderedNames) || input.orderedNames.length === 0) {
    throw new Error('Status order is required.');
  }

  const normalizedNames = input.orderedNames.map(normalizeStatusName);
  const uniqueNames = new Set(normalizedNames);
  if (uniqueNames.size !== normalizedNames.length) {
    throw new Error('Status order contains duplicates.');
  }

  const supabase = await createClient();

  const { data: existingStatuses, error: existingError } = await supabase
    .from('ticket_statuses')
    .select('name')
    .eq('organization_id', organizationId);

  if (existingError) {
    throw new Error(existingError.message ?? 'Failed to validate status order.');
  }

  const existingNames = new Set((existingStatuses ?? []).map(status => status.name));
  if (existingNames.size !== normalizedNames.length) {
    throw new Error('Status order is out of date. Refresh and try again.');
  }
  if (!normalizedNames.every(name => existingNames.has(name))) {
    throw new Error('Status order contains unknown statuses.');
  }

  for (const [position, name] of normalizedNames.entries()) {
    const { error: updateError } = await supabase
      .from('ticket_statuses')
      .update({ position })
      .eq('organization_id', organizationId)
      .eq('name', name);

    if (updateError) {
      throw new Error(updateError.message ?? 'Failed to reorder statuses.');
    }
  }

  const { data, error: selectError } = await supabase
    .from('ticket_statuses')
    .select('name,status_type,position,is_default')
    .eq('organization_id', organizationId)
    .order('position', { ascending: true });

  if (selectError) {
    throw new Error(selectError.message ?? 'Failed to load reordered statuses.');
  }

  revalidatePath('/u');
  revalidatePath(`/${organizationId}`);
  revalidatePath(`/${organizationId}/projects/${projectId}`);

  return (data ?? []).map(status => ({
    name: status.name,
    statusType: status.status_type,
    position: status.position,
    isDefault: status.is_default
  }));
}
