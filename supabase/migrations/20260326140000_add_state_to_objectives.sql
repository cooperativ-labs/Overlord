alter table "public"."objectives"
  add column "state" text null
  check ("state" in ('executing', 'complete'));
