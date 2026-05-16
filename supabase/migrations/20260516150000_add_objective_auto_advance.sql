-- Sequential objective execution with manual approval gates.
--
-- Adds per-objective auto-advance control:
--   - auto_advance:      whether the platform should automatically promote +
--                        relaunch this objective when its turn comes (default
--                        true so the feature is opt-out per row).
--   - approval_reason:   populated when an agent calls request-approval-gate
--                        or a user explicitly pauses; rendered in the
--                        awaiting-approval banner.
--   - auto_advanced_at:  timestamp set by the deliver auto-advance path when
--                        a row was promoted and relaunched without human
--                        intervention. Drives the "Auto-advanced" indicator
--                        in the objective history UI.
--
-- Awaiting-approval reuses tickets.has_unopened_waiting_response so the
-- existing red badge / notification path fires without schema changes.

alter table public.objectives
  add column if not exists auto_advance boolean not null default true,
  add column if not exists approval_reason text,
  add column if not exists auto_advanced_at timestamptz;

-- Telemetry / feed visibility for the auto-advance scheduler.
alter type "public"."ticket_event_type" add value if not exists 'awaiting_approval';
alter type "public"."ticket_event_type" add value if not exists 'auto_advance';
