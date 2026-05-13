-- Allow signed-in clients (e.g. mobile) to read global feature toggles; writes remain service-role / admin only.
create policy "authenticated_select_app_features"
on public.app_features
for select
to authenticated
using (true);
