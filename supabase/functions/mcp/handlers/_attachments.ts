// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { resolveSession } from '../session.ts';

type AttachmentAccess =
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

const WRITE_ROLES = new Set(['AGENT', 'MANAGER', 'ADMIN']);

export function sanitizeAttachmentFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[\\/\0]/g, '-')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) return 'attachment';
  return sanitized.slice(0, 180);
}

export function buildObjectiveAttachmentStoragePath(
  ticket: { organization_id: number; project_id: string | null; id: string },
  objectiveId: string,
  fileName: string
) {
  return `${ticket.organization_id}/${ticket.project_id ?? 'personal'}/${ticket.id}/${objectiveId}/${Date.now()}-${sanitizeAttachmentFileName(fileName)}`;
}

export function ensureObjectiveAttachmentStoragePath(
  storagePath: string,
  ticket: { organization_id: number; project_id: string | null; id: string },
  objectiveId: string
) {
  const expectedPrefix = `${ticket.organization_id}/${ticket.project_id ?? 'personal'}/${ticket.id}/${objectiveId}/`;
  return storagePath.startsWith(expectedPrefix);
}

export function buildAttachmentSignedUploadUrl(storagePath: string, token: string) {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const encodedPath = storagePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${supabaseUrl}/storage/v1/object/upload/sign/artifacts/${encodedPath}?token=${encodeURIComponent(token)}`;
}

export async function resolveAttachmentAccess(
  supabase: SupabaseClient,
  args: { sessionKey: string; ticketId: string; objectiveId: string; requireWrite: boolean },
  ctx: TokenContext
): Promise<AttachmentAccess> {
  const resolved = await resolveSession(
    supabase,
    args.sessionKey,
    args.ticketId,
    ctx.organizationId,
    ctx.mcpSessionId
  );
  if (!resolved.session) {
    return {
      error: resolved.error ?? 'Session not found.',
      session: null,
      ticket: null
    };
  }
  const resolvedTicketId = resolved.resolvedTicketId!;

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id, organization_id, project_id')
    .eq('id', resolvedTicketId)
    .eq('organization_id', ctx.organizationId)
    .single();

  if (ticketError || !ticket) {
    return {
      error: 'Ticket not found or access denied.',
      session: null,
      ticket: null
    };
  }

  const { data: objective, error: objectiveError } = await supabase
    .from('objectives')
    .select('id')
    .eq('id', args.objectiveId)
    .eq('ticket_id', resolvedTicketId)
    .single();

  if (objectiveError || !objective) {
    return {
      error: 'Objective not found for ticket.',
      session: null,
      ticket: null
    };
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('role')
    .eq('organization_id', ctx.organizationId)
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (memberError || !member?.role) {
    return {
      error: 'Membership not found for token user.',
      session: null,
      ticket: null
    };
  }

  if (args.requireWrite && !WRITE_ROLES.has(member.role)) {
    return {
      error: 'Insufficient role for attachment write access.',
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
