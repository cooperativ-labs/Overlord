-- Public read: allow anyone to read objects in app-downloads (e.g. electron-updater installers)
create policy "Public read app-downloads"
  on storage.objects for select
  to public
  using (bucket_id = 'app-downloads');
