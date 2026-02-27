// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { resolveSession } from '../session.ts';

type ArtifactAccess =
  | {
      error: string;
      session: null;
      ticket: null;
    }
  | {
      error: null;
      session: { id: string };
      ticket: { id: string; organization_id: number; project_id: string };
    };

const WRITE_ROLES = new Set(['AGENT', 'MANAGER', 'ADMIN']);

export function sanitizeArtifactFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[\\/\0]/g, '-')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) return 'artifact';
  return sanitized.slice(0, 180);
}

export function buildTicketStoragePath(
  ticket: { organization_id: number; project_id: string; id: string },
  fileName: string
) {
  return `${ticket.organization_id}/${ticket.project_id}/${ticket.id}/${Date.now()}-${sanitizeArtifactFileName(fileName)}`;
}

export function ensureTicketStoragePath(
  storagePath: string,
  ticket: { organization_id: number; project_id: string; id: string }
) {
  const expectedPrefix = `${ticket.organization_id}/${ticket.project_id}/${ticket.id}/`;
  return storagePath.startsWith(expectedPrefix);
}

export function buildSignedUploadUrl(storagePath: string, token: string) {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const encodedPath = storagePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${supabaseUrl}/storage/v1/object/upload/sign/artifacts/${encodedPath}?token=${encodeURIComponent(token)}`;
}

export async function resolveArtifactAccess(
  supabase: SupabaseClient,
  args: { sessionKey: string; ticketId: string; requireWrite: boolean },
  ctx: TokenContext
): Promise<ArtifactAccess> {
  const resolved = await resolveSession(
    supabase,
    args.sessionKey,
    args.ticketId,
    ctx.organizationId
  );
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
    .eq('id', args.ticketId)
    .eq('organization_id', ctx.organizationId)
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
