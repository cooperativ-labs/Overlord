-- Change the default for auto_advance on objectives from true to false.
-- New draft and future objectives should require explicit opt-in to auto-advance.
alter table "public"."objectives"
  alter column auto_advance set default false;
