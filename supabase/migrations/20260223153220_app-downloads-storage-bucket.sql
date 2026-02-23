-- Create app-downloads storage bucket for hosting app installers/updates
insert into storage.buckets (id, name, public)
values ('app-downloads', 'app-downloads', false)
on conflict (id) do nothing;
