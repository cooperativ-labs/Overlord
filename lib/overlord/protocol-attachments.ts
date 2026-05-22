import { getSupabaseUrl } from '@/lib/env';
import { resolveSession } from '@/lib/overlord/protocol-db';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

type OrganizationRole = Database['public']['Enums']['organization_role'];

const WRITE_ROLES = new Set<OrganizationRole>(['AGENT', 'MANAGER', 'ADMIN']);

type TicketForAttachment = {
  id: string;
  organization_id: number;
  project_id: string | null;
};

type ObjectiveForAttachment = {
  id: string;
  ticket_id: string;
};

type AttachmentAccessInput = {
  organizationId: number;
  objectiveId: string;
  requireWrite: boolean;
  sessionKey: string;
  ticketId?: string;
  userId: string;
};

/**
 * Looks up the ticket_id that owns the given objective. Returns null if the
 * objective is missing or belongs to a different organization.
 */
export async function resolveTicketIdFromObjective(
  objectiveId: string,
  organizationId: number
): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('objectives')
    .select('ticket_id, ticket:tickets!inner(organization_id)')
    .eq('id', objectiveId)
    .eq('ticket.organization_id', organizationId)
    .maybeSingle();

  return data?.ticket_id ?? null;
}

/**
 * Looks up the ticket_id that owns the given attachment. Returns null if
 * the attachment is missing or belongs to a different organization.
 */
export async function resolveTicketIdFromAttachment(
  attachmentId: string,
  organizationId: number
): Promise<{ ticketId: string; objectiveId: string; storagePath: string } | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('objective_attachments')
    .select('ticket_id, objective_id, storage_path, ticket:tickets!inner(organization_id)')
    .eq('id', attachmentId)
    .eq('ticket.organization_id', organizationId)
    .maybeSingle();

  if (!data?.ticket_id || !data.objective_id || !data.storage_path) return null;
  return {
    objectiveId: data.objective_id,
    storagePath: data.storage_path,
    ticketId: data.ticket_id
  };
}

type AttachmentAccessResult =
  | {
      error: string;
      objective: null;
      session: null;
      ticket: null;
    }
  | {
      error: null;
      objective: ObjectiveForAttachment;
      session: { id: string; objective_id: string };
      ticket: TicketForAttachment;
    };

export function sanitizeAttachmentFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[\\/\0]/g, '-')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    return 'attachment';
  }

  return sanitized.slice(0, 180);
}

export function buildObjectiveAttachmentStoragePath(
  ticket: TicketForAttachment,
  objectiveId: string,
  fileName: string
) {
  return `${ticket.organization_id}/${ticket.project_id ?? 'personal'}/${ticket.id}/${objectiveId}/${Date.now()}-${sanitizeAttachmentFileName(fileName)}`;
}

export function ensureObjectiveAttachmentStoragePath(
  storagePath: string,
  ticket: TicketForAttachment,
  objectiveId: string
) {
  const expectedPrefix = `${ticket.organization_id}/${ticket.project_id ?? 'personal'}/${ticket.id}/${objectiveId}/`;
  return storagePath.startsWith(expectedPrefix);
}

export function buildAttachmentSignedUploadUrl(storagePath: string, token: string) {
  const supabaseUrl = getSupabaseUrl().replace(/\/$/, '');
  const encodedPath = storagePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${supabaseUrl}/storage/v1/object/upload/sign/artifacts/${encodedPath}?token=${encodeURIComponent(token)}`;
}

export async function resolveAttachmentAccess(
  input: AttachmentAccessInput
): Promise<AttachmentAccessResult> {
  const supabase = createServiceRoleClient();

  const ticketId =
    input.ticketId ?? (await resolveTicketIdFromObjective(input.objectiveId, input.organizationId));
  if (!ticketId) {
    return {
      error: 'Objective not found or access denied.',
      objective: null,
      session: null,
      ticket: null
    };
  }

  const resolved = await resolveSession(input.sessionKey, ticketId, input.organizationId);
  if (!resolved.session) {
    return {
      error: resolved.error ?? 'Session not found.',
      objective: null,
      session: null,
      ticket: null
    };
  }

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id, organization_id, project_id')
    .eq('id', ticketId)
    .eq('organization_id', input.organizationId)
    .single();

  if (ticketError || !ticket) {
    return {
      error: 'Ticket not found or access denied.',
      objective: null,
      session: null,
      ticket: null
    };
  }

  const { data: objective, error: objectiveError } = await supabase
    .from('objectives')
    .select('id, ticket_id')
    .eq('id', input.objectiveId)
    .eq('ticket_id', ticketId)
    .single();

  if (objectiveError || !objective) {
    return {
      error: 'Objective not found for ticket.',
      objective: null,
      session: null,
      ticket: null
    };
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('role')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (memberError || !member?.role) {
    return {
      error: 'Membership not found for token user.',
      objective: null,
      session: null,
      ticket: null
    };
  }

  if (input.requireWrite && !WRITE_ROLES.has(member.role)) {
    return {
      error: 'Insufficient role for attachment write access.',
      objective: null,
      session: null,
      ticket: null
    };
  }

  return {
    error: null,
    objective,
    session: { id: resolved.session.id, objective_id: resolved.session.objective_id },
    ticket
  };
}
