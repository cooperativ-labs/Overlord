-- Remove policies that used using (true) for authenticated users, which OR'd with
-- admin policies and allowed any logged-in user to read/update every invitation row.
drop policy if exists "invitations_update_by_token" on public.organization_invitations;
drop policy if exists "invitations_select_by_token" on public.organization_invitations;
