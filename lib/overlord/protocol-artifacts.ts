import { getSupabaseUrl } from '@/lib/env';
import { resolveSession } from '@/lib/overlord/protocol-db';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

type OrganizationRole = Database['public']['Enums']['organization_role'];

const WRITE_ROLES = new Set<OrganizationRole>(['AGENT', 'MANAGER', 'ADMIN']);

type ArtifactAccessInput = {
  organizationId: number;
  requireWrite: boolean;
  sessionKey: string;
  ticketId: string;
  userId: string;
};

type ArtifactAccessResult =
  | {
      error: string;
      session: null;
      ticket: null;
    }
  | {
      error: null;
      session: { id: string };
      ticket: { id: string; organization_id: number; project_id: string | null };
    };

export function sanitizeArtifactFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[\\/\0]/g, '-')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    return 'artifact';
  }

  return sanitized.slice(0, 180);
}

export function buildTicketStoragePath(
  ticket: { organization_id: number; project_id: string | null; id: string },
  fileName: string
) {
  return `${ticket.organization_id}/${ticket.project_id ?? 'personal'}/${ticket.id}/${Date.now()}-${sanitizeArtifactFileName(fileName)}`;
}

export function ensureTicketStoragePath(
  storagePath: string,
  ticket: { organization_id: number; project_id: string | null; id: string }
) {
  const expectedPrefix = `${ticket.organization_id}/${ticket.project_id ?? 'personal'}/${ticket.id}/`;
  return storagePath.startsWith(expectedPrefix);
}

export function buildSignedUploadUrl(storagePath: string, token: string) {
  const supabaseUrl = getSupabaseUrl().replace(/\/$/, '');
  const encodedPath = storagePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${supabaseUrl}/storage/v1/object/upload/sign/artifacts/${encodedPath}?token=${encodeURIComponent(token)}`;
}

export async function resolveArtifactAccess(
  input: ArtifactAccessInput
): Promise<ArtifactAccessResult> {
  const supabase = createServiceRoleClient();
  const resolved = await resolveSession(input.sessionKey, input.ticketId, input.organizationId);
  if (!resolved.session) {
    return {
      error: resolved.error ?? 'Session not found.',
      session: null,
      ticket: null
    };
  }

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id, organization_id, project_id')
    .eq('id', input.ticketId)
    .eq('organization_id', input.organizationId)
    .single();

  if (ticketError || !ticket) {
    return {
      error: 'Ticket not found or access denied.',
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
      session: null,
      ticket: null
    };
  }

  if (input.requireWrite && !WRITE_ROLES.has(member.role)) {
    return {
      error: 'Insufficient role for artifact write access.',
      session: null,
      ticket: null
    };
  }

  return {
    error: null,
    session: { id: resolved.session.id },
    ticket
  };
}
