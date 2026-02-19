create table "public"."projects" (
  "id" uuid not null default gen_random_uuid(),
  "organization_id" integer not null,
  "name" text not null,
  "color" text not null default '#d4d4d8'::text,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "updated_at" timestamp with time zone not null default timezone('utc'::text, now()),
  constraint "projects_pkey" primary key ("id"),
  constraint "projects_color_hex_check" check (color ~ '^#([0-9A-Fa-f]{6})$'::text),
  constraint "projects_organization_id_fkey"
    foreign key (organization_id)
    references public.organizations(id)
    on delete cascade
);

alter table "public"."projects" enable row level security;

create unique index projects_id_organization_id_key on public.projects using btree (id, organization_id);
create index projects_organization_id_idx on public.projects using btree (organization_id);

create trigger set_projects_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

grant delete on table "public"."projects" to "authenticated";
grant insert on table "public"."projects" to "authenticated";
grant select on table "public"."projects" to "authenticated";
grant update on table "public"."projects" to "authenticated";
grant delete on table "public"."projects" to "service_role";
grant insert on table "public"."projects" to "service_role";
grant select on table "public"."projects" to "service_role";
grant update on table "public"."projects" to "service_role";

create policy "projects_delete_manager_plus"
on "public"."projects"
as permissive
for delete
to authenticated
using (
  public.has_org_role(
    organization_id,
    array['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
  )
);

create policy "projects_insert_agent_plus"
on "public"."projects"
as permissive
for insert
to authenticated
with check (
  public.has_org_role(
    organization_id,
    array[
      'AGENT'::public.organization_role,
      'MANAGER'::public.organization_role,
      'ADMIN'::public.organization_role
    ]
  )
);

create policy "projects_select_member"
on "public"."projects"
as permissive
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "projects_update_agent_plus"
on "public"."projects"
as permissive
for update
to authenticated
using (
  public.has_org_role(
    organization_id,
    array[
      'AGENT'::public.organization_role,
      'MANAGER'::public.organization_role,
      'ADMIN'::public.organization_role
    ]
  )
)
with check (
  public.has_org_role(
    organization_id,
    array[
      'AGENT'::public.organization_role,
      'MANAGER'::public.organization_role,
      'ADMIN'::public.organization_role
    ]
  )
);

alter table "public"."tickets"
add column "project_id" uuid;

create index tickets_project_id_idx on public.tickets using btree (project_id);

alter table "public"."tickets"
add constraint "tickets_project_org_fkey"
foreign key (project_id, organization_id)
references public.projects(id, organization_id)
on update cascade
on delete set null;
