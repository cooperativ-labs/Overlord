alter table "public"."auth_grants" drop constraint "auth_grants_user_id_fkey";

alter table "public"."device_auth_codes" drop constraint "device_auth_codes_user_id_fkey";

alter table "public"."tickets" drop constraint "tickets_created_by_fkey";

alter table "public"."tickets" alter column "created_by" drop not null;

alter table "public"."auth_grants" add constraint "auth_grants_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."auth_grants" validate constraint "auth_grants_user_id_fkey";

alter table "public"."device_auth_codes" add constraint "device_auth_codes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."device_auth_codes" validate constraint "device_auth_codes_user_id_fkey";

alter table "public"."tickets" add constraint "tickets_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."tickets" validate constraint "tickets_created_by_fkey";


