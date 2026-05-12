alter table public.feed_posts
  add column if not exists summary text not null default '',
  add column if not exists objective_sections jsonb not null default '[]'::jsonb,
  add column if not exists orphan_file_changes jsonb not null default '[]'::jsonb,
  add column if not exists total_events integer not null default 0,
  add column if not exists total_files integer not null default 0,
  add column if not exists pending_actions integer not null default 0,
  add column if not exists source_session_ids uuid[] not null default '{}';

comment on column public.feed_posts.summary is
  'Mutable ticket-level summary displayed at the top of the feed post.';

comment on column public.feed_posts.objective_sections is
  'Structured objective timeline sections for the ticket rollup, including per-objective body, files, actions, and tradeoffs.';

comment on column public.feed_posts.orphan_file_changes is
  'Ticket-level file changes where file_changes.objective_id is null.';

comment on column public.feed_posts.total_events is
  'Denormalized count of ticket events represented by the rollup.';

comment on column public.feed_posts.total_files is
  'Denormalized count of unique file paths represented by the rollup.';

comment on column public.feed_posts.pending_actions is
  'Denormalized count of human action items represented by the rollup.';

comment on column public.feed_posts.source_session_ids is
  'All agent sessions that contributed events to this ticket-level feed post.';

comment on column public.feed_posts.objective_id is
  'Latest objective materially represented in this ticket-level feed post rollup.';

comment on column public.feed_posts.session_id is
  'Latest contributing agent session for compatibility; source_session_ids contains the full session provenance.';

create index if not exists idx_feed_posts_org_updated
  on public.feed_posts (organization_id, updated_at desc);

create index if not exists idx_feed_posts_project_updated
  on public.feed_posts (project_id, updated_at desc);

with ranked as (
  select
    id,
    row_number() over (
      partition by ticket_id
      order by updated_at desc, created_at desc, id desc
    ) as rank
  from public.feed_posts
)
delete from public.feed_posts
using ranked
where public.feed_posts.id = ranked.id
  and ranked.rank > 1;

create unique index if not exists feed_posts_ticket_id_unique
  on public.feed_posts (ticket_id);
