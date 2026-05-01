-- Organization invitations: allow admins/managers to invite users by email.

create extension if not exists pgcrypto with schema extensions;

create table public.organization_invitations (
  id              uuid        primary key default gen_random_uuid(),
  organization_id int         not null references public.organizations(id) on delete cascade,
  invited_by      uuid        not null references auth.users(id),
  email           text        not null,
  role            public.organization_role not null default 'VIEWER',
  token           text        not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  status          text        not null default 'pending'
                              check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  expires_at      timestamptz not null default now() + interval '7 days',
  accepted_by     uuid        references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Prevent duplicate pending invitations for the same email+org
create unique index org_invitations_pending_email_idx
  on public.organization_invitations(organization_id, lower(email))
  where status = 'pending';

alter table public.organization_invitations enable row level security;

-- Admins/Managers can view invitations for their org (token lookups use service role in app code).
create policy "invitations_select_admin"
  on public.organization_invitations for select
  using (has_org_role(organization_id, array['ADMIN','MANAGER']::organization_role[]));

-- Admins/Managers can create invitations
create policy "invitations_insert_admin"
  on public.organization_invitations for insert
  with check (has_org_role(organization_id, array['ADMIN','MANAGER']::organization_role[]));

-- Admins/Managers can cancel/resend; accept/decline use service role in server actions.
create policy "invitations_update_admin"
  on public.organization_invitations for update
  using (has_org_role(organization_id, array['ADMIN','MANAGER']::organization_role[]));
