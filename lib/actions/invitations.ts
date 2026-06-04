'use server';

import * as Sentry from '@sentry/nextjs';
import { Resend } from 'resend';

import { getPlatformUrl } from '@/lib/env';
import { ORGANIZATION_ROLE_ORDER, type OrganizationRole } from '@/lib/organization-roles';
import { acceptInvitationForUser } from '@/lib/overlord/invitations';
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

type InvitationEmailOptions = {
  to: string;
  inviterName: string;
  orgName: string;
  role: OrganizationRole;
  token: string;
};

export async function buildInvitationEmailContent(opts: InvitationEmailOptions): Promise<{
  subject: string;
  text: string;
  html: string;
}> {
  const acceptUrl = `${getPlatformUrl()}/invite/${opts.token}`;
  const roleDesc = ROLE_DESCRIPTIONS[opts.role];
  const escapedInviterName = escapeHtml(opts.inviterName);
  const escapedOrgName = escapeHtml(opts.orgName);
  const escapedRole = escapeHtml(opts.role);
  const escapedRoleDesc = escapeHtml(roleDesc);
  const escapedAcceptUrl = escapeHtml(acceptUrl);
  const escapedToken = escapeHtml(opts.token);
  const installCommand = 'npm install -g overlord-cli';
  const onboardCommand = `ovld onboard --invite ${opts.token}`;

  return Promise.resolve({
    subject: `You've been invited to join ${opts.orgName} on Overlord`,
    text: [
      `${opts.inviterName} has invited you to join ${opts.orgName} on Overlord as ${opts.role}.`,
      roleDesc,
      '',
      `Accept your invitation: ${acceptUrl}`,
      '',
      'For AI agents: onboard yourself from the terminal.',
      `  1. Install the CLI:  ${installCommand}`,
      `  2. Onboard with this invite:  ${onboardCommand}`,
      '',
      `Invitation code: ${opts.token}`,
      '',
      'This invitation expires in 7 days.'
    ].join('\n'),
    html: `
      <!doctype html>
      <html lang="en" style="margin: 0; padding: 0">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <meta name="x-apple-disable-message-reformatting" />
          <meta name="color-scheme" content="light only" />
          <meta name="supported-color-schemes" content="light only" />
          <title>You've been invited to Overlord.</title>
          <!--[if mso]>
            <style>
              * {
                font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important;
              }
            </style>
          <![endif]-->
          <style>
            @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap');
            body,
            table,
            td,
            a {
              -webkit-text-size-adjust: 100%;
              -ms-text-size-adjust: 100%;
            }
            table,
            td {
              mso-table-lspace: 0pt;
              mso-table-rspace: 0pt;
            }
            img {
              -ms-interpolation-mode: bicubic;
              border: 0;
              outline: none;
              text-decoration: none;
            }
            body {
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
            }
            a {
              color: #1c1917;
            }
            a.cta:hover {
              background: #000 !important;
            }
            a.text-link:hover {
              text-decoration: underline !important;
            }
            @media only screen and (max-width: 620px) {
              .container {
                width: 100% !important;
                padding-left: 20px !important;
                padding-right: 20px !important;
              }
              .card {
                padding: 28px 24px !important;
                border-radius: 18px !important;
              }
              .headline {
                font-size: 26px !important;
                line-height: 1.15 !important;
              }
              .footer {
                padding: 24px 24px 32px !important;
              }
              .stack-block {
                padding: 14px 16px !important;
              }
            }
          </style>
        </head>
        <body
          style="
            margin: 0;
            padding: 0;
            background: #f6f4ef;
            font-family: 'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #1c1917;
          "
        >
          <div
            style="
              display: none;
              max-height: 0;
              overflow: hidden;
              mso-hide: all;
              font-size: 1px;
              line-height: 1px;
              color: #f6f4ef;
            "
          >
            ${escapedInviterName} invited you to join ${escapedOrgName} on Overlord.
          </div>

          <table
            role="presentation"
            cellpadding="0"
            cellspacing="0"
            border="0"
            width="100%"
            style="background: #f6f4ef"
          >
            <tr>
              <td align="center" style="padding: 32px 16px 8px">
                <table
                  role="presentation"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  width="600"
                  class="container"
                  style="max-width: 600px; width: 100%"
                >
                  <tr>
                    <td align="left" style="padding: 0 4px 24px">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="vertical-align: middle; padding-right: 12px">
                            <img
                              src="https://zitmmhvbilhjjdwgxlfm.supabase.co/storage/v1/object/public/org-images/Overlord/256.png"
                              width="36"
                              height="36"
                              alt="Overlord"
                              style="display: block; width: 36px; height: 36px; border-radius: 8px"
                            />
                          </td>
                          <td
                            style="
                              vertical-align: middle;
                              font-family:
                                'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                              font-weight: 600;
                              font-size: 18px;
                              letter-spacing: -0.02em;
                              color: #1c1917;
                            "
                          >
                            Overlord
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table
                  role="presentation"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  width="600"
                  class="container"
                  style="max-width: 600px; width: 100%"
                >
                  <tr>
                    <td
                      class="card"
                      style="
                        background: #ffffff;
                        border: 1px solid #e7e5e0;
                        border-radius: 20px;
                        padding: 40px 40px 36px;
                      "
                    >
                      <div
                        style="
                          font-family: 'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace;
                          font-size: 11px;
                          font-weight: 500;
                          letter-spacing: 0.22em;
                          text-transform: uppercase;
                          color: #a8a29e;
                          margin: 0 0 18px;
                        "
                      >
                        WORKSPACE INVITE
                      </div>
                      <h1
                        class="headline"
                        style="
                          margin: 0 0 16px;
                          font-family: 'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                          font-weight: 600;
                          font-size: 30px;
                          line-height: 1.1;
                          letter-spacing: -0.04em;
                          color: #1c1917;
                        "
                      >
                        Join ${escapedOrgName} on Overlord.
                      </h1>
                      <div
                        style="
                          font-family: 'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                          font-size: 16px;
                          line-height: 1.6;
                          color: #57534e;
                        "
                      >
                        <p style="margin: 0 0 14px">
                          <strong style="color: #1c1917">${escapedInviterName}</strong> invited you
                          to join <strong style="color: #1c1917">${escapedOrgName}</strong> on
                          Overlord as
                          <span
                            style="
                              font-family: 'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace;
                              font-size: 0.92em;
                              background: #f4f3ee;
                              border: 1px solid #e7e5e0;
                              border-radius: 4px;
                              padding: 1px 6px;
                              color: #1c1917;
                              white-space: nowrap;
                            "
                            >${escapedRole}</span
                          >.
                        </p>
                        <p style="margin: 0 0 14px">${escapedRoleDesc}</p>
                        <div
                          class="stack-block"
                          style="
                            margin: 20px 0 0;
                            padding: 16px 18px;
                            background: #fafaf7;
                            border: 1px solid #e7e5e0;
                            border-radius: 14px;
                            color: #57534e;
                          "
                        >
                          Accept the invite to join the workspace. This invitation expires in 7 days.
                        </div>
                      </div>

                      <table
                        role="presentation"
                        cellpadding="0"
                        cellspacing="0"
                        border="0"
                        style="margin: 28px 0 8px"
                      >
                        <tr>
                          <td style="background: #1c1917; border-radius: 9999px">
                            <a
                              class="cta"
                              href="${escapedAcceptUrl}"
                              style="
                                display: inline-block;
                                padding: 14px 28px;
                                font-family:
                                  'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                                font-weight: 600;
                                font-size: 15px;
                                letter-spacing: -0.01em;
                                color: #fafaf7;
                                text-decoration: none;
                                border-radius: 9999px;
                              "
                            >
                              Accept Invite&nbsp;&rarr;
                            </a>
                          </td>
                        </tr>
                      </table>

                      <div
                        class="stack-block"
                        style="
                          margin: 28px 0 0;
                          padding: 18px 20px;
                          background: #fafaf7;
                          border: 1px solid #e7e5e0;
                          border-radius: 14px;
                        "
                      >
                        <div
                          style="
                            font-family: 'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace;
                            font-size: 11px;
                            font-weight: 500;
                            letter-spacing: 0.22em;
                            text-transform: uppercase;
                            color: #a8a29e;
                            margin: 0 0 10px;
                          "
                        >
                          For AI Agents
                        </div>
                        <p
                          style="
                            margin: 0 0 12px;
                            font-family: 'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                            font-size: 14px;
                            line-height: 1.6;
                            color: #57534e;
                          "
                        >
                          Onboard yourself from the terminal — install the Overlord CLI and run
                          onboarding with this invite.
                        </p>
                        <div
                          style="
                            font-family: 'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace;
                            font-size: 13px;
                            line-height: 1.7;
                            background: #1c1917;
                            color: #fafaf7;
                            border-radius: 10px;
                            padding: 12px 14px;
                            white-space: nowrap;
                            overflow-x: auto;
                          "
                        >
                          ${escapeHtml(installCommand)}<br />
                          ${escapeHtml(onboardCommand)}
                        </div>
                        <p
                          style="
                            margin: 12px 0 0;
                            font-family: 'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                            font-size: 12px;
                            color: #a8a29e;
                          "
                        >
                          Invitation code:
                          <span
                            style="
                              font-family: 'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace;
                              color: #57534e;
                              word-break: break-all;
                            "
                            >${escapedToken}</span
                          >
                        </p>
                      </div>

                      <div
                        style="
                          margin-top: 24px;
                          padding-top: 24px;
                          border-top: 1px solid #e7e5e0;
                          font-family: 'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                          font-size: 13px;
                          line-height: 1.5;
                          color: #a8a29e;
                        "
                      >
                        Button doesn't work? Paste this URL into your browser:<br />
                        <a
                          class="text-link"
                          href="${escapedAcceptUrl}"
                          style="color: #57534e; word-break: break-all; text-decoration: underline"
                          >${escapedAcceptUrl}</a
                        >
                      </div>
                    </td>
                  </tr>
                </table>

                <table
                  role="presentation"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  width="600"
                  class="container"
                  style="max-width: 600px; width: 100%"
                >
                  <tr>
                    <td
                      class="footer"
                      align="left"
                      style="
                        padding: 28px 4px 40px;
                        font-family: 'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                        font-size: 12px;
                        line-height: 1.6;
                        color: #a8a29e;
                      "
                    >
                      <div style="margin-bottom: 8px">
                        <a
                          class="text-link"
                          href="${escapeHtml(getPlatformUrl())}"
                          style="color: #57534e; text-decoration: none; font-weight: 500"
                          >ovld.ai</a
                        >
                        &nbsp;·&nbsp; Agent work, organized.
                      </div>

                      <div style="margin-top: 8px; color: #a8a29e">
                        You're receiving this because someone used this email address to invite you
                        to ${escapedOrgName} on Overlord. If that wasn't expected, you can safely
                        ignore this message.
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `
  });
}

async function sendInvitationEmail(opts: InvitationEmailOptions) {
  const resend = getResendClient();
  const content = await buildInvitationEmailContent(opts);

  await resend.emails.send({
    from: getFromEmail(),
    to: opts.to,
    subject: content.subject,
    text: content.text,
    html: content.html
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

  // Web accepts require the signed-in email to match the invited email. The CLI
  // onboarding path uses the same helper with a soft match (see ticket 1:1358).
  const result = await acceptInvitationForUser({
    token,
    userId: user.id,
    userEmail: user.email,
    enforceEmailMatch: true
  });

  if (!result.ok) return { error: result.error };

  const serviceSupabase = createServiceRoleClient();

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
        onboarding: { ...current, invited_organization_id: result.organizationId }
      })
      .eq('id', user.id);
  }

  return { organizationId: result.organizationId, isNewUser };
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
