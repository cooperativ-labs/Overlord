-- Ranked ticket search: weighted vectors, pg_trgm indexes, and a single RPC contract.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.build_ticket_search_vector(
  p_title text,
  p_identifier text,
  p_first_objective text
)
returns tsvector
language sql
immutable
as $$
  select
    setweight(to_tsvector('english', coalesce(p_title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p_identifier, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p_first_objective, '')), 'B');
$$;

create or replace function public.build_ticket_prefix_tsquery(p_query text)
returns tsquery
language sql
immutable
as $$
  select case
    when coalesce(btrim(p_query), '') = '' then null::tsquery
    else (
      select to_tsquery(
        'english',
        string_agg(
          regexp_replace(term, '[^a-zA-Z0-9-]', '', 'g') || ':*',
          ' & '
          order by ord
        )
      )
      from unnest(regexp_split_to_array(btrim(p_query), '\s+')) with ordinality as t(term, ord)
      where regexp_replace(term, '[^a-zA-Z0-9-]', '', 'g') <> ''
    )
  end;
$$;

create or replace function public.escape_like_pattern(p_value text)
returns text
language sql
immutable
as $$
  select replace(replace(coalesce(p_value, ''), '%', '\%'), '_', '\_');
$$;

create or replace function public.update_tickets_search_vector()
returns trigger
language plpgsql
as $$
declare
  title_text text := coalesce(new.title, '');
  identifier_text text := coalesce(new.ticket_id, coalesce(new.ticket_sequence::text, ''));
  first_objective_text text := public.first_ticket_objective_text(new.id);
begin
  new.search_vector := public.build_ticket_search_vector(
    title_text,
    identifier_text,
    first_objective_text
  );
  return new;
end;
$$;

create or replace function public.refresh_ticket_search_vector_from_objectives()
returns trigger
language plpgsql
as $$
declare
  affected_ticket_id uuid := coalesce(new.ticket_id, old.ticket_id);
begin
  if affected_ticket_id is null then
    return null;
  end if;

  update public.tickets t
  set search_vector = public.build_ticket_search_vector(
    coalesce(t.title, ''),
    coalesce(t.ticket_id, coalesce(t.ticket_sequence::text, '')),
    public.first_ticket_objective_text(t.id)
  )
  where t.id = affected_ticket_id;

  return null;
end;
$$;

update public.tickets t
set search_vector = public.build_ticket_search_vector(
  coalesce(t.title, ''),
  coalesce(t.ticket_id, coalesce(t.ticket_sequence::text, '')),
  public.first_ticket_objective_text(t.id)
);

create index if not exists tickets_title_trgm_idx
  on public.tickets using gin (title extensions.gin_trgm_ops);

create index if not exists tickets_ticket_id_trgm_idx
  on public.tickets using gin (ticket_id extensions.gin_trgm_ops);

create or replace function public.search_tickets(
  p_query text default '',
  p_exact_ticket_id text default null,
  p_organization_id integer default null,
  p_limit integer default 8,
  p_include_completed boolean default false,
  p_statuses text[] default null,
  p_project_id uuid default null,
  p_created_by uuid default null,
  p_updated_after timestamptz default null,
  p_updated_before timestamptz default null
)
returns table (
  id uuid,
  title text,
  ticket_id text,
  ticket_sequence bigint,
  project_id uuid,
  organization_id integer,
  status text,
  project_name text,
  search_rank double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with params as (
    select
      btrim(coalesce(p_query, '')) as sanitized_query,
      nullif(btrim(coalesce(p_exact_ticket_id, '')), '') as exact_ticket_id,
      greatest(1, least(coalesce(p_limit, 8), 50)) as result_limit
  ),
  query as (
    select
      sanitized_query,
      exact_ticket_id,
      public.escape_like_pattern(sanitized_query) as escaped_query,
      public.build_ticket_prefix_tsquery(sanitized_query) as prefix_tsquery,
      case
        when sanitized_query = '' then null::tsquery
        else websearch_to_tsquery('english', sanitized_query)
      end as web_tsquery
    from params
  ),
  filtered as (
    select
      t.id,
      t.title,
      t.ticket_id,
      t.ticket_sequence,
      t.project_id,
      t.organization_id,
      t.status,
      p.name as project_name,
      t.updated_at,
      t.search_vector,
      q.sanitized_query,
      q.exact_ticket_id,
      q.escaped_query,
      q.prefix_tsquery,
      q.web_tsquery
    from public.tickets t
    left join public.projects p on p.id = t.project_id
    cross join query q
    where (p_organization_id is null or t.organization_id = p_organization_id)
      and (p_project_id is null or t.project_id = p_project_id)
      and (p_created_by is null or t.created_by = p_created_by)
      and (p_updated_after is null or t.updated_at >= p_updated_after)
      and (p_updated_before is null or t.updated_at <= p_updated_before)
      and (
        p_statuses is not null and cardinality(p_statuses) > 0
          and t.status = any (p_statuses)
        or p_statuses is null and (p_include_completed or t.status <> 'complete')
      )
  ),
  ranked as (
    select
      f.id,
      f.title,
      f.ticket_id,
      f.ticket_sequence,
      f.project_id,
      f.organization_id,
      f.status,
      f.project_name,
      (
        case
          when f.exact_ticket_id is not null and lower(f.ticket_id) = lower(f.exact_ticket_id) then 1000.0
          else 0.0
        end
        + case
            when f.sanitized_query <> '' and lower(f.title) = lower(f.sanitized_query) then 900.0
            else 0.0
          end
        + case
            when f.sanitized_query <> '' and f.title ilike f.escaped_query || '%' escape '\' then 800.0
            else 0.0
          end
        + case
            when f.sanitized_query <> '' and f.title ilike '%' || f.escaped_query || '%' escape '\' then 700.0
            else 0.0
          end
        + case
            when f.sanitized_query <> ''
              and similarity(f.title, f.sanitized_query) > 0.2
            then similarity(f.title, f.sanitized_query) * 600.0
            else 0.0
          end
        + coalesce(ts_rank_cd(f.search_vector, f.prefix_tsquery, 32), 0.0) * 50.0
        + coalesce(ts_rank_cd(f.search_vector, f.web_tsquery, 32), 0.0) * 30.0
        + extract(epoch from f.updated_at) / 1000000000.0
      ) as search_rank
    from filtered f
    cross join query q
    where f.sanitized_query = ''
      or (
        f.exact_ticket_id is not null
        and lower(f.ticket_id) = lower(f.exact_ticket_id)
      )
      or (
        f.sanitized_query <> ''
        and f.title ilike '%' || f.escaped_query || '%' escape '\'
      )
      or (
        f.prefix_tsquery is not null
        and f.search_vector @@ f.prefix_tsquery
      )
      or (
        f.web_tsquery is not null
        and f.search_vector @@ f.web_tsquery
      )
  )
  select
    r.id,
    r.title,
    r.ticket_id,
    r.ticket_sequence,
    r.project_id,
    r.organization_id,
    r.status,
    r.project_name,
    r.search_rank
  from ranked r
  order by r.search_rank desc, r.title asc
  limit (select result_limit from params);
$$;

grant execute on function public.search_tickets(
  text,
  text,
  integer,
  integer,
  boolean,
  text[],
  uuid,
  uuid,
  timestamptz,
  timestamptz
) to authenticated, service_role;
