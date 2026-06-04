import * as Sentry from '@sentry/nextjs';

import type { OrganizationRole } from '@/lib/organization-roles';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export type AcceptInvitationResult =
  | {
      ok: true;
      organizationId: number;
      organizationName: string | null;
      role: OrganizationRole;
      alreadyMember: boolean;
    }
  | { ok: false; error: string };

/**
 * Accept an organization invitation on behalf of a user. Shared by the web
 * `acceptInvitationAction` (which enforces an email match) and the CLI
 * onboarding endpoint (which accepts on token possession — see ticket 1:1358).
 *
 * The invitation token is the bearer secret: it is single-use (flipped to
 * `accepted` on consume) and expiring (flipped to `expired` on read once past
 * `expires_at`). Membership upsert is idempotent, so re-accepting an already
 * joined org is a no-op success.
 */
export async function acceptInvitationForUser(input: {
  token: string;
  userId: string;
  userEmail: string | null | undefined;
  /** When true, require the accepting user's email to equal the invited email. */
  enforceEmailMatch: boolean;
}): Promise<AcceptInvitationResult> {
  const supabase = createServiceRoleClient();

  const { data: invitation } = await supabase
    .from('organization_invitations')
    .select('id, organization_id, email, role, status, expires_at')
    .eq('token', input.token)
    .maybeSingle();

  if (!invitation) return { ok: false, error: 'Invitation not found.' };

  if (invitation.status !== 'pending') {
    const messages: Record<string, string> = {
      accepted: 'This invitation has already been accepted.',
      cancelled: 'This invitation has been cancelled.',
      declined: 'This invitation was declined.',
      expired: 'This invitation has expired. Please request a new one.'
    };
    return {
      ok: false,
      error: messages[invitation.status] ?? 'This invitation is no longer valid.'
    };
  }

  if (new Date(invitation.expires_at) < new Date()) {
    await supabase
      .from('organization_invitations')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', invitation.id);
    return { ok: false, error: 'This invitation has expired. Please request a new one.' };
  }

  if (
    input.enforceEmailMatch &&
    input.userEmail?.toLowerCase() !== invitation.email.toLowerCase()
  ) {
    return {
      ok: false,
      error: `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`
    };
  }

  // Upsert membership (idempotent).
  const { data: existing } = await supabase
    .from('members')
    .select('user_id')
    .eq('organization_id', invitation.organization_id)
    .eq('user_id', input.userId)
    .maybeSingle();

  const alreadyMember = Boolean(existing);

  if (!existing) {
    const { error: memberError } = await supabase.from('members').insert({
      organization_id: invitation.organization_id,
      user_id: input.userId,
      role: invitation.role
    });

    if (memberError) {
      Sentry.captureException(memberError);
      return { ok: false, error: 'Failed to add you to the organization. Please try again.' };
    }
  }

  await supabase
    .from('organization_invitations')
    .update({
      status: 'accepted',
      accepted_by: input.userId,
      updated_at: new Date().toISOString()
    })
    .eq('id', invitation.id);

  const { data: organization } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', invitation.organization_id)
    .maybeSingle();

  return {
    ok: true,
    organizationId: invitation.organization_id,
    organizationName: organization?.name ?? null,
    role: invitation.role as OrganizationRole,
    alreadyMember
  };
}
