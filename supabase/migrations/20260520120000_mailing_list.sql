-- mailing_list: tracks email marketing consent per user.
-- One row per auth user, auto-populated on signup.
-- Each column represents consent for a specific email type (boolean).

create table public.mailing_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null default '',
  new_features boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_mailing_list_updated_at
  before update on public.mailing_list
  for each row execute function public.set_updated_at();

alter table public.mailing_list enable row level security;

-- Users can read and update their own row.
create policy "mailing_list_select_own"
  on public.mailing_list
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "mailing_list_update_own"
  on public.mailing_list
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Admin can read all rows.
create policy "mailing_list_select_admin"
  on public.mailing_list
  for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'jake@cooperativ.io');

-- Auto-insert new users into the mailing list on signup.
create or replace function public.handle_new_user_mailing_list()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.mailing_list (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_add_to_mailing_list
  after insert on auth.users
  for each row execute function public.handle_new_user_mailing_list();

-- Backfill existing users.
insert into public.mailing_list (user_id, email)
select id, coalesce(email, '')
from auth.users
on conflict (user_id) do nothing;
