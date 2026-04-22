alter table "public"."artifacts" drop constraint "artifacts_uploaded_by_fkey";

alter table "public"."agent_tokens" drop constraint "agent_tokens_user_id_fkey";

alter table "public"."feedback" drop constraint "feedback_user_id_fkey";

alter table "public"."artifacts" drop column "uploaded_by";

alter table "public"."agent_tokens" add constraint "agent_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."agent_tokens" validate constraint "agent_tokens_user_id_fkey";

alter table "public"."feedback" add constraint "feedback_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."feedback" validate constraint "feedback_user_id_fkey";


