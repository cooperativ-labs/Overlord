'use server';

import * as Sentry from '@sentry/nextjs';
import { Resend } from 'resend';

import { getPlatformUrl } from '@/lib/env';
import { ORGANIZATION_ROLE_ORDER, type OrganizationRole } from '@/lib/organization-roles';
import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

// ─── Types ───────────────────────────────────────────────────────────────────

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';

export type OrganizationInvitation = {
  id: string;
  organizationId: number;
  invitedBy: string;
  email: string;
  role: OrganizationRole;
  token: string;
  status: InvitationStatus;
  expiresAt: string;
  acceptedBy: string | null;
  createdAt: string;
  inviterName: string | null;
};

export type InvitationWithOrg = OrganizationInvitation & {
  organizationName: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing RESEND_API_KEY.');
  return new Resend(apiKey);
}

function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || 'Overlord <ovld@notifications.cooperativ.io>';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const ROLE_DESCRIPTIONS: Record<OrganizationRole, string> = {
  VIEWER: 'Can view tickets, feed, and project activity.',
  AGENT: 'Can create and run agent sessions.',
  MANAGER: 'Can manage projects, members, and agent sessions.',
  ADMIN: 'Full access including org settings and member management.'
};

async function sendInvitationEmail(opts: {
  to: string;
  inviterName: string;
  orgName: string;
  role: OrganizationRole;
  token: string;
}) {
  const resend = getResendClient();
  const acceptUrl = `${getPlatformUrl()}/invite/${opts.token}`;
  const roleDesc = ROLE_DESCRIPTIONS[opts.role];

  await resend.emails.send({
    from: getFromEmail(),
    to: opts.to,
    subject: `You've been invited to join ${opts.orgName} on Overlord`,
    text: [
      `${opts.inviterName} has invited you to join ${opts.orgName} on Overlord as ${opts.role}.`,
      roleDesc,
      '',
      `Accept your invitation: ${acceptUrl}`,
      '',
      'This invitation expires in 7 days.'
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
        <h1 style="font-size:20px;margin-bottom:8px;">You're invited to join ${escapeHtml(opts.orgName)}</h1>
        <p style="color:#555;margin-bottom:24px;">
          <strong>${escapeHtml(opts.inviterName)}</strong> has invited you to join
          <strong>${escapeHtml(opts.orgName)}</strong> on Overlord as
          <strong>${escapeHtml(opts.role)}</strong>.
        </p>
        <p style="color:#555;margin-bottom:32px;">${escapeHtml(roleDesc)}</p>
        <a href="${acceptUrl}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">
          Accept invitation
        </a>
        <p style="color:#999;font-size:12px;margin-top:32px;">
          This invitation expires in 7 days. If you didn't expect this, you can safely ignore this email.
        </p>
      </div>
    `
  });
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function inviteUserToOrganizationAction(
  organizationId: number,
  email: string,
  role: OrganizationRole
): Promise<{ error?: string }> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Unauthorized' };

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { error: 'Enter a valid email address.' };
  }

  if (normalizedEmail === user.email?.toLowerCase()) {
    return { error: 'You cannot invite yourself.' };
  }

  // Caller must be ADMIN or MANAGER and can only invite up to their own role level
  const { data: callerMember } = await supabase
    .from('members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!callerMember) return { error: 'Unauthorized' };

  const callerLevel = ORGANIZATION_ROLE_ORDER.indexOf(callerMember.role as OrganizationRole);
  const targetLevel = ORGANIZATION_ROLE_ORDER.indexOf(role);
  if (callerLevel < ORGANIZATION_ROLE_ORDER.indexOf('MANAGER')) {
    return { error: 'Only Managers and Admins can invite members.' };
  }
  if (targetLevel > callerLevel) {
    return { error: 'You cannot invite someone to a role higher than your own.' };
  }

  // Rate limit: max 20 pending invitations per org
  const { count } = await supabase
    .from('organization_invitations')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('status', 'pending');

  if ((count ?? 0) >= 20) {
    return { error: 'Too many pending invitations. Cancel some before sending more.' };
  }

  // Check if already a member
  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (targetProfile) {
    const { data: alreadyMember } = await supabase
      .from('members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('user_id', targetProfile.id)
      .maybeSingle();

    if (alreadyMember) {
      return { error: 'This person is already a member of this organization.' };
    }
  }

  // Fetch org + inviter info for the email
  const [orgResult, inviterResult] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', organizationId).single(),
    supabase.from('profiles').select('name').eq('id', user.id).maybeSingle()
  ]);

  if (orgResult.error || !orgResult.data) {
    return { error: 'Organization not found.' };
  }

  const { error: insertError } = await supabase.from('organization_invitations').insert({
    organization_id: organizationId,
    invited_by: user.id,
    email: normalizedEmail,
    role
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return { error: 'An invitation is already pending for this address.' };
    }
    Sentry.captureException(insertError);
    return { error: 'Failed to create invitation. Please try again.' };
  }

  // Fetch the newly created invitation token
  const { data: invitation } = await supabase
    .from('organization_invitations')
    .select('token')
    .eq('organization_id', organizationId)
    .eq('email', normalizedEmail)
    .eq('status', 'pending')
    .maybeSingle();

  if (invitation) {
    try {
      await sendInvitationEmail({
        to: normalizedEmail,
        inviterName: inviterResult.data?.name ?? user.email ?? 'Someone',
        orgName: orgResult.data.name,
        role,
        token: invitation.token
      });
    } catch (err) {
      Sentry.captureException(err);
      // Email failure is non-fatal; the invitation row exists and can be resent
    }
  }

  return {};
}

export async function getOrganizationInvitationsAction(
  organizationId: number
): Promise<OrganizationInvitation[]> {
  const supabase = await createClientForRequest();

  const { data, error } = await supabase
    .from('organization_invitations')
    .select(
      'id, organization_id, invited_by, email, role, token, status, expires_at, accepted_by, created_at'
    )
    .eq('organization_id', organizationId)
    .in('status', ['pending', 'expired'])
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const inviterIds = [...new Set((data ?? []).map(r => r.invited_by))];
  const profilesById = new Map<string, string | null>();
  if (inviterIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', inviterIds);
    for (const p of profiles ?? []) {
      profilesById.set(p.id, p.name ?? null);
    }
  }

  return (data ?? []).map(row => ({
    id: row.id,
    organizationId: row.organization_id,
    invitedBy: row.invited_by,
    email: row.email,
    role: row.role as OrganizationRole,
    token: row.token,
    status: row.status as InvitationStatus,
    expiresAt: row.expires_at,
    acceptedBy: row.accepted_by ?? null,
    createdAt: row.created_at,
    inviterName: profilesById.get(row.invited_by) ?? null
  }));
}

export async function cancelInvitationAction(invitationId: string): Promise<{ error?: string }> {
  const supabase = await createClientForRequest();

  const { error } = await supabase
    .from('organization_invitations')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('status', 'pending');

  if (error) {
    Sentry.captureException(error);
    return { error: 'Failed to cancel invitation.' };
  }
  return {};
}

export async function resendInvitationAction(invitationId: string): Promise<{ error?: string }> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const { data: invitation, error: fetchError } = await supabase
    .from('organization_invitations')
    .select('id, organization_id, email, role, token, status')
    .eq('id', invitationId)
    .eq('status', 'pending')
    .maybeSingle();

  if (fetchError || !invitation) return { error: 'Invitation not found.' };

  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: updateError } = await supabase
    .from('organization_invitations')
    .update({ expires_at: newExpiry, updated_at: new Date().toISOString() })
    .eq('id', invitationId);

  if (updateError) {
    Sentry.captureException(updateError);
    return { error: 'Failed to extend invitation.' };
  }

  const [orgResult, inviterResult] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', invitation.organization_id).single(),
    supabase.from('profiles').select('name').eq('id', user.id).maybeSingle()
  ]);

  if (!orgResult.error && orgResult.data) {
    try {
      await sendInvitationEmail({
        to: invitation.email,
        inviterName: inviterResult.data?.name ?? user.email ?? 'Someone',
        orgName: orgResult.data.name,
        role: invitation.role as OrganizationRole,
        token: invitation.token
      });
    } catch (err) {
      Sentry.captureException(err);
    }
  }

  return {};
}

export async function getInvitationByTokenAction(token: string): Promise<InvitationWithOrg | null> {
  // Use service role to support unauthenticated lookups — the token is the security primitive
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('organization_invitations')
    .select(
      'id, organization_id, invited_by, email, role, token, status, expires_at, accepted_by, created_at'
    )
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;

  const [orgResult, inviterResult] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', data.organization_id).single(),
    supabase.from('profiles').select('name').eq('id', data.invited_by).maybeSingle()
  ]);

  return {
    id: data.id,
    organizationId: data.organization_id,
    invitedBy: data.invited_by,
    email: data.email,
    role: data.role as OrganizationRole,
    token: data.token,
    status: data.status as InvitationStatus,
    expiresAt: data.expires_at,
    acceptedBy: data.accepted_by ?? null,
    createdAt: data.created_at,
    inviterName: inviterResult.data?.name ?? null,
    organizationName: orgResult.data?.name ?? ''
  };
}

export async function acceptInvitationAction(
  token: string
): Promise<{ error?: string; organizationId?: number; isNewUser?: boolean }> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { error: 'You must be signed in to accept an invitation.' };

  const serviceSupabase = createServiceRoleClient();

  const { data: invitation } = await serviceSupabase
    .from('organization_invitations')
    .select('id, organization_id, email, role, status, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!invitation) return { error: 'Invitation not found.' };

  if (invitation.status !== 'pending') {
    const messages: Record<string, string> = {
      accepted: 'This invitation has already been accepted.',
      cancelled: 'This invitation has been cancelled.',
      declined: 'This invitation was declined.',
      expired: 'This invitation has expired. Please request a new one.'
    };
    return { error: messages[invitation.status] ?? 'This invitation is no longer valid.' };
  }

  if (new Date(invitation.expires_at) < new Date()) {
    await serviceSupabase
      .from('organization_invitations')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', invitation.id);
    return { error: 'This invitation has expired. Please request a new one.' };
  }

  if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return {
      error: `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`
    };
  }

  // Upsert membership (idempotent)
  const { data: existing } = await serviceSupabase
    .from('members')
    .select('user_id')
    .eq('organization_id', invitation.organization_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existing) {
    const { error: memberError } = await serviceSupabase.from('members').insert({
      organization_id: invitation.organization_id,
      user_id: user.id,
      role: invitation.role
    });

    if (memberError) {
      Sentry.captureException(memberError);
      return { error: 'Failed to add you to the organization. Please try again.' };
    }
  }

  await serviceSupabase
    .from('organization_invitations')
    .update({
      status: 'accepted',
      accepted_by: user.id,
      updated_at: new Date().toISOString()
    })
    .eq('id', invitation.id);

  // Determine if this is a new user (only the invited org so far)
  const { count } = await serviceSupabase
    .from('members')
    .select('organization_id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const isNewUser = (count ?? 0) <= 1;

  if (isNewUser) {
    const { data: profile } = await serviceSupabase
      .from('profiles')
      .select('onboarding')
      .eq('id', user.id)
      .maybeSingle();

    const current = (profile?.onboarding as Record<string, unknown>) ?? {};
    await serviceSupabase
      .from('profiles')
      .update({
        onboarding: { ...current, invited_organization_id: invitation.organization_id }
      })
      .eq('id', user.id);
  }

  return { organizationId: invitation.organization_id, isNewUser };
}

export async function declineInvitationAction(token: string): Promise<{ error?: string }> {
  const supabase = createServiceRoleClient();

  const { data: invitation, error: fetchError } = await supabase
    .from('organization_invitations')
    .select('id, status')
    .eq('token', token)
    .maybeSingle();

  if (fetchError) {
    Sentry.captureException(fetchError);
    return { error: 'Failed to load invitation.' };
  }

  if (!invitation) return { error: 'Invitation not found.' };
  if (invitation.status !== 'pending') return {};

  const { error } = await supabase
    .from('organization_invitations')
    .update({ status: 'declined', updated_at: new Date().toISOString() })
    .eq('id', invitation.id);

  if (error) {
    Sentry.captureException(error);
    return { error: 'Failed to decline invitation.' };
  }

  return {};
}
