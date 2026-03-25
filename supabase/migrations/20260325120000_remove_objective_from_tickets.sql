-- Remove the legacy objective column from tickets table
-- Objectives are now stored in the objectives table
alter table "public"."tickets" drop column if exists "objective";
