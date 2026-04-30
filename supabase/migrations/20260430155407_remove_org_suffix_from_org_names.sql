create or replace function public.create_organization_for_current_user(target_name text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_organization_id integer;
  effective_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'create_organization_for_current_user must be called as an authenticated user';
  end if;

  effective_name := coalesce(
    nullif(trim(target_name), ''),
    nullif(
      trim(coalesce((select raw_user_meta_data ->> 'name' from auth.users where id = auth.uid()), '')),
      ''
    ),
    nullif(
      trim(split_part(coalesce((select email from auth.users where id = auth.uid()), ''), '@', 1)),
      ''
    ),
    'Organization ' || left((select auth.uid())::text, 8)
  );

  insert into public.organizations (name)
  values (effective_name)
  returning id into new_organization_id;

  insert into public.members (organization_id, user_id, role)
  values (new_organization_id, (select auth.uid()), 'ADMIN')
  on conflict (organization_id, user_id) do nothing;

  perform public.seed_default_ticket_statuses_for_organization(new_organization_id);

  return new_organization_id;
end;
$function$;
