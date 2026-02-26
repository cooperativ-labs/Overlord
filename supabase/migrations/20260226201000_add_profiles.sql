-- Store user-level profile details and custom agent instructions

create table "public"."profiles" (
  "id" uuid not null references auth.users(id) on delete cascade,
  "name" text not null default ''::text,
  "email" text not null default ''::text,
  "image_url" text not null default ''::text,
  "custom_agent_instructions" text not null default ''::text,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "updated_at" timestamp with time zone not null default timezone('utc'::text, now()),
  primary key (id)
);

alter table "public"."profiles" enable row level security;

create policy "profiles_select_own"
  on "public"."profiles"
  as permissive
  for select
  to authenticated
using ((select auth.uid()) = id);

create policy "profiles_insert_own"
  on "public"."profiles"
  as permissive
  for insert
  to authenticated
with check ((select auth.uid()) = id);

create policy "profiles_update_own"
  on "public"."profiles"
  as permissive
  for update
  to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "profiles_delete_own"
  on "public"."profiles"
  as permissive
  for delete
  to authenticated
using ((select auth.uid()) = id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, name, email, image_url)
  values (
    new.id,
    coalesce(
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      'User'
    ),
    coalesce(new.email, ''),
    coalesce(
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), ''),
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'picture', '')), ''),
      ''
    )
  )
  on conflict (id) do update
    set
      name = excluded.name,
      email = excluded.email,
      image_url = excluded.image_url;

  return new;
end;
$$;

create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

insert into public.profiles (id, name, email, image_url)
select
  u.id,
  coalesce(
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'name', '')), ''),
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(split_part(coalesce(u.email, ''), '@', 1)), ''),
    'User'
  ) as name,
  coalesce(u.email, '') as email,
  coalesce(
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'avatar_url', '')), ''),
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'picture', '')), ''),
    ''
  ) as image_url
from auth.users u
on conflict (id) do update
  set
    name = excluded.name,
    email = excluded.email,
    image_url = excluded.image_url;
