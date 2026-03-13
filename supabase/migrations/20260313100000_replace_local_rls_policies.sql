-- Replace permissive "local" RLS policies on agent_sessions, artifacts,
-- shared_state, and ticket_events with proper organization-scoped policies.
--
-- All four tables have a ticket_id FK → tickets.organization_id, which we use
-- to verify the authenticated user is a member of the ticket's organization.

-- ============================================================================
-- Helper: Check if the user is an org member for a given ticket.
-- Avoids duplicating the subquery in every policy.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_ticket_org_member(p_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_org_member(
    (SELECT t.organization_id FROM public.tickets t WHERE t.id = p_ticket_id)
  );
$$;

-- ============================================================================
-- AGENT_SESSIONS — org members can read; AGENT+ can write
-- ============================================================================

DROP POLICY IF EXISTS "agent_sessions_select_local" ON "public"."agent_sessions";
DROP POLICY IF EXISTS "agent_sessions_insert_local" ON "public"."agent_sessions";
DROP POLICY IF EXISTS "agent_sessions_update_local" ON "public"."agent_sessions";
DROP POLICY IF EXISTS "agent_sessions_delete_local" ON "public"."agent_sessions";

CREATE POLICY "agent_sessions_select"
  ON "public"."agent_sessions"
  AS permissive
  FOR SELECT
  TO authenticated
  USING (public.is_ticket_org_member(ticket_id));

CREATE POLICY "agent_sessions_insert"
  ON "public"."agent_sessions"
  AS permissive
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_org_role(
      (SELECT t.organization_id FROM public.tickets t WHERE t.id = ticket_id),
      ARRAY['AGENT','MANAGER','ADMIN']::public.organization_role[]
    )
  );

CREATE POLICY "agent_sessions_update"
  ON "public"."agent_sessions"
  AS permissive
  FOR UPDATE
  TO authenticated
  USING (public.is_ticket_org_member(ticket_id))
  WITH CHECK (public.is_ticket_org_member(ticket_id));

CREATE POLICY "agent_sessions_delete"
  ON "public"."agent_sessions"
  AS permissive
  FOR DELETE
  TO authenticated
  USING (
    public.has_org_role(
      (SELECT t.organization_id FROM public.tickets t WHERE t.id = ticket_id),
      ARRAY['MANAGER','ADMIN']::public.organization_role[]
    )
  );

-- ============================================================================
-- ARTIFACTS — org members can read; AGENT+ can write
-- ============================================================================

DROP POLICY IF EXISTS "artifacts_select_local" ON "public"."artifacts";
DROP POLICY IF EXISTS "artifacts_insert_local" ON "public"."artifacts";
DROP POLICY IF EXISTS "artifacts_update_local" ON "public"."artifacts";
DROP POLICY IF EXISTS "artifacts_delete_local" ON "public"."artifacts";

CREATE POLICY "artifacts_select"
  ON "public"."artifacts"
  AS permissive
  FOR SELECT
  TO authenticated
  USING (public.is_ticket_org_member(ticket_id));

CREATE POLICY "artifacts_insert"
  ON "public"."artifacts"
  AS permissive
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_org_role(
      (SELECT t.organization_id FROM public.tickets t WHERE t.id = ticket_id),
      ARRAY['AGENT','MANAGER','ADMIN']::public.organization_role[]
    )
  );

CREATE POLICY "artifacts_update"
  ON "public"."artifacts"
  AS permissive
  FOR UPDATE
  TO authenticated
  USING (public.is_ticket_org_member(ticket_id))
  WITH CHECK (public.is_ticket_org_member(ticket_id));

CREATE POLICY "artifacts_delete"
  ON "public"."artifacts"
  AS permissive
  FOR DELETE
  TO authenticated
  USING (
    public.has_org_role(
      (SELECT t.organization_id FROM public.tickets t WHERE t.id = ticket_id),
      ARRAY['MANAGER','ADMIN']::public.organization_role[]
    )
  );

-- ============================================================================
-- SHARED_STATE — org members can read; AGENT+ can write
-- shared_state.ticket_id can be NULL (global context), so handle both cases.
-- ============================================================================

DROP POLICY IF EXISTS "shared_state_select_local" ON "public"."shared_state";
DROP POLICY IF EXISTS "shared_state_insert_local" ON "public"."shared_state";
DROP POLICY IF EXISTS "shared_state_update_local" ON "public"."shared_state";
DROP POLICY IF EXISTS "shared_state_delete_local" ON "public"."shared_state";

CREATE POLICY "shared_state_select"
  ON "public"."shared_state"
  AS permissive
  FOR SELECT
  TO authenticated
  USING (
    ticket_id IS NULL  -- global state visible to all authenticated users
    OR public.is_ticket_org_member(ticket_id)
  );

CREATE POLICY "shared_state_insert"
  ON "public"."shared_state"
  AS permissive
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN ticket_id IS NULL THEN true  -- global state can be written by any authenticated user
      ELSE public.has_org_role(
        (SELECT t.organization_id FROM public.tickets t WHERE t.id = ticket_id),
        ARRAY['AGENT','MANAGER','ADMIN']::public.organization_role[]
      )
    END
  );

CREATE POLICY "shared_state_update"
  ON "public"."shared_state"
  AS permissive
  FOR UPDATE
  TO authenticated
  USING (
    ticket_id IS NULL OR public.is_ticket_org_member(ticket_id)
  )
  WITH CHECK (
    ticket_id IS NULL OR public.is_ticket_org_member(ticket_id)
  );

CREATE POLICY "shared_state_delete"
  ON "public"."shared_state"
  AS permissive
  FOR DELETE
  TO authenticated
  USING (
    CASE
      WHEN ticket_id IS NULL THEN true
      ELSE public.has_org_role(
        (SELECT t.organization_id FROM public.tickets t WHERE t.id = ticket_id),
        ARRAY['MANAGER','ADMIN']::public.organization_role[]
      )
    END
  );

-- ============================================================================
-- TICKET_EVENTS — org members can read; AGENT+ can insert; MANAGER+ can delete
-- ============================================================================

DROP POLICY IF EXISTS "ticket_events_select_local" ON "public"."ticket_events";
DROP POLICY IF EXISTS "ticket_events_insert_local" ON "public"."ticket_events";
DROP POLICY IF EXISTS "ticket_events_update_local" ON "public"."ticket_events";
DROP POLICY IF EXISTS "ticket_events_delete_local" ON "public"."ticket_events";

CREATE POLICY "ticket_events_select"
  ON "public"."ticket_events"
  AS permissive
  FOR SELECT
  TO authenticated
  USING (public.is_ticket_org_member(ticket_id));

CREATE POLICY "ticket_events_insert"
  ON "public"."ticket_events"
  AS permissive
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_ticket_org_member(ticket_id));

CREATE POLICY "ticket_events_update"
  ON "public"."ticket_events"
  AS permissive
  FOR UPDATE
  TO authenticated
  USING (public.is_ticket_org_member(ticket_id))
  WITH CHECK (public.is_ticket_org_member(ticket_id));

CREATE POLICY "ticket_events_delete"
  ON "public"."ticket_events"
  AS permissive
  FOR DELETE
  TO authenticated
  USING (
    public.has_org_role(
      (SELECT t.organization_id FROM public.tickets t WHERE t.id = ticket_id),
      ARRAY['MANAGER','ADMIN']::public.organization_role[]
    )
  );
