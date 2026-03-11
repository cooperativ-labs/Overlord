alter table "public"."tickets" drop column "everhour_project_id";

alter table "public"."tickets" add column "is_read" boolean not null default true;


