-- Swap execute and review positions so the flow is:
-- Draft (0) → Execute (1) → Review (2) → Complete (3) → Blocked (4) → Cancelled (5)

-- Update existing ticket_statuses rows: swap execute and review positions
UPDATE public.ticket_statuses SET position = 1 WHERE name = 'execute';
UPDATE public.ticket_statuses SET position = 2 WHERE name = 'review';

-- Remove the unused 'refine' status if it exists
DELETE FROM public.ticket_statuses WHERE name = 'refine';

-- Update the account seed function
CREATE OR REPLACE FUNCTION public.seed_default_ticket_statuses_for_account(target_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.ticket_statuses (account_id, name, status_type, position, is_default)
  values
    (target_account_id, 'draft', 'draft', 0, true),
    (target_account_id, 'execute', 'execute', 1, true),
    (target_account_id, 'review', 'review', 2, true),
    (target_account_id, 'complete', 'complete', 3, true),
    (target_account_id, 'blocked', 'execute', 4, true),
    (target_account_id, 'cancelled', 'complete', 5, true)
  on conflict (account_id, name) do nothing;
end;
$function$;

-- Update the organization seed function
CREATE OR REPLACE FUNCTION public.seed_default_ticket_statuses_for_organization(target_organization_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.ticket_statuses (organization_id, name, status_type, position, is_default)
  values
    (target_organization_id, 'draft', 'draft', 0, true),
    (target_organization_id, 'execute', 'execute', 1, true),
    (target_organization_id, 'review', 'review', 2, true),
    (target_organization_id, 'complete', 'complete', 3, true),
    (target_organization_id, 'blocked', 'execute', 4, true),
    (target_organization_id, 'cancelled', 'complete', 5, true)
  on conflict (organization_id, name) do nothing;
end;
$function$;
