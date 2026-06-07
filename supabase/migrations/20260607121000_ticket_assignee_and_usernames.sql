-- =============================================================================
-- Ticket assignee + human-readable usernames (ticket 1:1342)
--
-- 1. profiles.username  — a globally unique, human-readable handle per user.
-- 2. members.id — the human-readable member primary key: [orgid]:[username].
-- 3. tickets.assigned_member — the human owner of a ticket (stores members.id).
--    Defaults to the creator, freely editable, explicitly nullable on unassign.
-- 4. get_org_member_directory — a SECURITY DEFINER directory RPC returning only
--    safe display columns to verified co-members (powers the assignee picker
--    without widening base-table RLS on the sensitive profiles columns).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles.username
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists username text;

-- Slug rules: lowercase, 3-32 chars, must start/end alphanumeric, inner chars
-- may include `. _ -`. Null is tolerated only during the backfill window.
alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format check (
    username is null
    or (
      char_length(username) between 3 and 32
      and username ~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$'
    )
  );

-- Case-insensitive global uniqueness.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

-- Generate a unique, slugified handle from a seed (email local-part or name).
-- Loops with a numeric suffix on collision. Used by the profile trigger and the
-- one-time backfill below.
create or replace function public.generate_unique_username(seed text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix integer := 1;
  max_base_len integer;
begin
  base := lower(coalesce(seed, ''));
  base := regexp_replace(base, '[^a-z0-9._-]+', '', 'g'); -- drop invalid chars
  base := regexp_replace(base, '^[._-]+', '');            -- trim leading seps
  base := regexp_replace(base, '[._-]+$', '');            -- trim trailing seps

  if char_length(base) < 3 then
    base := 'user';
  end if;
  if char_length(base) > 32 then
    base := substr(base, 1, 32);
    base := regexp_replace(base, '[._-]+$', '');
  end if;
  if char_length(base) < 3 then
    base := 'user';
  end if;

  candidate := base;
  while exists (
    select 1 from public.profiles p where lower(p.username) = lower(candidate)
  ) loop
    suffix := suffix + 1;
    -- Keep the suffixed candidate within 32 chars.
    max_base_len := 32 - char_length(suffix::text);
    candidate :=
      regexp_replace(substr(base, 1, greatest(max_base_len, 1)), '[._-]+$', '')
      || suffix::text;
  end loop;

  return candidate;
end;
$$;

revoke all on function public.generate_unique_username(text) from public;

-- Extend the existing new-user profile trigger to populate username on insert.
-- On conflict (re-sync) we preserve any user-chosen username.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  resolved_name text;
  resolved_email text;
  resolved_image text;
  resolved_username text;
begin
  resolved_name := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'User'
  );
  resolved_email := coalesce(new.email, '');
  resolved_image := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'picture', '')), ''),
    ''
  );
  resolved_username := public.generate_unique_username(
    coalesce(nullif(split_part(resolved_email, '@', 1), ''), resolved_name)
  );

  insert into public.profiles (id, name, email, image_url, username)
  values (new.id, resolved_name, resolved_email, resolved_image, resolved_username)
  on conflict (id) do update
    set
      name = excluded.name,
      email = excluded.email,
      image_url = excluded.image_url,
      username = coalesce(profiles.username, excluded.username);

  return new;
end;
$$;

-- Backfill usernames for existing profiles. generate_unique_username consults
-- already-assigned handles each iteration, so collisions resolve in order.
do $$
declare
  r record;
begin
  for r in
    select id, email, name from public.profiles where username is null order by created_at
  loop
    update public.profiles
      set username = public.generate_unique_username(
        coalesce(nullif(split_part(coalesce(r.email, ''), '@', 1), ''), r.name)
      )
      where id = r.id;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. members.id
-- -----------------------------------------------------------------------------

alter table public.members
  add column if not exists id text;

comment on column public.members.id is
  'Human-readable member primary key in the format [orgid]:[username].';

create or replace function public.member_identifier(org_id integer, username text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select org_id::text || ':' || lower(username);
$$;

revoke all on function public.member_identifier(integer, text) from public;

update public.members m
  set id = public.member_identifier(m.organization_id, p.username)
  from public.profiles p
  where p.id = m.user_id
    and m.id is null;

alter table public.members
  alter column id set not null;

create unique index if not exists members_org_user_key
  on public.members (organization_id, user_id);

alter table public.members
  drop constraint if exists members_pkey;

create unique index if not exists members_pkey
  on public.members (id);

alter table public.members
  add constraint members_pkey primary key using index members_pkey;

-- The prior composite identity remains enforced for membership lookups and any
-- future FKs that need to validate a user belongs to a specific organization.
alter table public.members
  drop constraint if exists members_org_user_unique;
alter table public.members
  add constraint members_org_user_unique unique using index members_org_user_key;

create or replace function public.set_member_identifier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_username text;
begin
  select p.username into resolved_username
  from public.profiles p
  where p.id = new.user_id;

  if resolved_username is null then
    raise exception 'Cannot create member identifier: profile username is missing for user %', new.user_id;
  end if;

  new.id := public.member_identifier(new.organization_id, resolved_username);
  return new;
end;
$$;

revoke all on function public.set_member_identifier() from public;

drop trigger if exists set_member_identifier on public.members;
create trigger set_member_identifier
  before insert or update of organization_id, user_id on public.members
  for each row execute function public.set_member_identifier();

create or replace function public.sync_member_identifiers_for_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.username is distinct from old.username then
    update public.members
      set id = public.member_identifier(organization_id, new.username)
      where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_member_identifiers_for_username() from public;

drop trigger if exists sync_member_identifiers_for_username on public.profiles;
create trigger sync_member_identifiers_for_username
  after update of username on public.profiles
  for each row execute function public.sync_member_identifiers_for_username();

-- -----------------------------------------------------------------------------
-- 3. tickets.assigned_member
-- -----------------------------------------------------------------------------

alter table public.tickets
  add column if not exists assigned_member text;

comment on column public.tickets.assigned_member is
  'members.id ([orgid]:[username]) of the human member who owns this ticket. '
  'Defaults to the creator on insert; nullable so an explicit unassign is allowed. Distinct from '
  'assigned_agent / delegate, which describe who/what executes the ticket.';

-- FK guarantees the assignee is a real member identifier, follows username
-- changes, and auto-nulls the assignment if the member leaves.
alter table public.tickets
  drop constraint if exists tickets_assigned_member_fkey;
alter table public.tickets
  add constraint tickets_assigned_member_fkey
  foreign key (assigned_member)
  references public.members (id)
  on update cascade
  on delete set null;

alter table public.tickets
  drop constraint if exists tickets_assigned_member_org_match;
alter table public.tickets
  add constraint tickets_assigned_member_org_match check (
    assigned_member is null
    or split_part(assigned_member, ':', 1) = organization_id::text
  );

create index if not exists tickets_org_assigned_member_idx
  on public.tickets (organization_id, assigned_member);

-- Default the assignee to the creator when not supplied (a column DEFAULT cannot
-- reference another column, so use a BEFORE INSERT trigger). created_by is
-- already populated (column default auth.uid() / set_ticket_organization_from_creator).
create or replace function public.set_default_ticket_assignee()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_member is null then
    select m.id into new.assigned_member
    from public.members m
    where m.organization_id = new.organization_id
      and m.user_id = new.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists set_ticket_assigned_member_default on public.tickets;
drop trigger if exists set_tickets_zz_assigned_member_default on public.tickets;
create trigger set_tickets_zz_assigned_member_default
  before insert on public.tickets
  for each row execute function public.set_default_ticket_assignee();

-- One-time backfill: existing tickets are owned by their creator, but only where
-- the creator is still a member of the ticket''s org (otherwise the FK fails).
update public.tickets t
  set assigned_member = m.id
  from public.members m
  where t.assigned_member is null
    and m.organization_id = t.organization_id
    and m.user_id = t.created_by;

-- -----------------------------------------------------------------------------
-- 4. get_org_member_directory RPC
-- -----------------------------------------------------------------------------

-- Returns only safe display columns for the members of org_id, and only to a
-- verified co-member of that org. Keeps the read surface tight instead of
-- widening RLS on profiles (which holds custom_agent_instructions / preferences).
create or replace function public.get_org_member_directory(org_id integer)
returns table (
  member_id text,
  user_id uuid,
  username text,
  name text,
  email text,
  image_url text,
  role public.organization_role,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id as member_id,
    m.user_id,
    p.username,
    p.name,
    p.email,
    p.image_url,
    m.role,
    m.created_at as joined_at
  from public.members m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = org_id
    and public.is_org_member(org_id)
  order by m.created_at asc;
$$;

revoke all on function public.get_org_member_directory(integer) from public;
grant execute on function public.get_org_member_directory(integer) to authenticated;
