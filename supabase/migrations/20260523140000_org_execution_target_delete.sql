-- Allow admins to delete organization_execution_targets, with automatic
-- pruning of orphaned execution_targets.

-- Trigger function: after deleting an organization_execution_target, if the
-- execution_target has no remaining organization associations, delete it too.
create or replace function public.auto_prune_orphaned_execution_target()
returns trigger language plpgsql security definer as $$
begin
  -- If no organization still references this execution target, remove it entirely.
  if not exists (
    select 1
    from public.organization_execution_targets
    where execution_target_id = old.execution_target_id
  ) then
    delete from public.execution_targets where id = old.execution_target_id;
  end if;
  return old;
end;
$$;

drop trigger if exists organization_execution_targets_auto_prune
  on public.organization_execution_targets;

create trigger organization_execution_targets_auto_prune
  after delete on public.organization_execution_targets
  for each row execute function public.auto_prune_orphaned_execution_target();
