-- Send new-user signup notifications from Supabase instead of the Next.js app.
-- Required Vault secrets:
--   1. project_url                         => e.g. https://<project-ref>.supabase.co
--   2. signup_notification_trigger_secret => shared bearer secret for the edge function

create extension if not exists "pg_net" with schema "extensions";
create schema if not exists "vault";
create extension if not exists "supabase_vault" with schema "vault";

create or replace function public.handle_new_user_signup_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  project_url text;
  trigger_secret text;
  provider text;
  user_name text;
begin
  if coalesce(new.email, '') = '' then
    return new;
  end if;

  select decrypted_secret
    into project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  order by created_at desc
  limit 1;

  select decrypted_secret
    into trigger_secret
  from vault.decrypted_secrets
  where name = 'signup_notification_trigger_secret'
  order by created_at desc
  limit 1;

  if project_url is null or trigger_secret is null then
    raise log 'Skipping signup notification for user %: missing Vault secrets.', new.id;
    return new;
  end if;

  provider := coalesce(
    nullif(trim(coalesce(new.raw_app_meta_data ->> 'provider', '')), ''),
    'email'
  );
  user_name := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  );

  perform net.http_post(
    url := project_url || '/functions/v1/send-signup-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || trigger_secret
    ),
    body := jsonb_build_object(
      'userId', new.id,
      'email', new.email,
      'name', user_name,
      'provider', provider
    )
  );

  return new;
exception
  when others then
    raise log 'Signup notification dispatch failed for user %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_send_signup_notification on auth.users;

create trigger on_auth_user_created_send_signup_notification
  after insert on auth.users
  for each row execute function public.handle_new_user_signup_notification();
