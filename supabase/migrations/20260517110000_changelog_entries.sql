-- changelog_entries: user-facing release notes, global (not org-scoped).
-- Drafts authored by admin, published rows visible to anon + authenticated.

create table public.changelog_entries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text,
  body_markdown text not null default '',
  body_html text,
  status text not null default 'draft',
  version text,
  source_window_start timestamptz,
  source_window_end timestamptz,
  source_feed_post_ids uuid[] not null default '{}',
  drafted_by uuid references auth.users(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint changelog_entries_status_check
    check (status in ('draft', 'published', 'archived'))
);

create index idx_changelog_entries_status_published
  on public.changelog_entries (status, published_at desc);

create trigger set_changelog_entries_updated_at
  before update on public.changelog_entries
  for each row execute function public.set_updated_at();

alter table public.changelog_entries enable row level security;

-- Anyone (including anon) can read published entries.
create policy "changelog_entries_select_published_anon"
  on public.changelog_entries
  for select
  to anon, authenticated
  using (status = 'published');

-- Admin can read everything (including drafts/archived).
create policy "changelog_entries_select_admin"
  on public.changelog_entries
  for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'jake@cooperativ.io');

create policy "changelog_entries_insert_admin"
  on public.changelog_entries
  for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'jake@cooperativ.io');

create policy "changelog_entries_update_admin"
  on public.changelog_entries
  for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'jake@cooperativ.io')
  with check (auth.jwt() ->> 'email' = 'jake@cooperativ.io');

create policy "changelog_entries_delete_admin"
  on public.changelog_entries
  for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'jake@cooperativ.io');

-- Track the most recent changelog read time per user for unread-toast detection.
alter table public.profiles
  add column if not exists last_changelog_read_at timestamptz not null default now();
