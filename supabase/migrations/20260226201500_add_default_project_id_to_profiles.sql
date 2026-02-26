-- Add default_project_id to profiles table
alter table "public"."profiles" add column "default_project_id" uuid references public.projects(id) on delete set null;
