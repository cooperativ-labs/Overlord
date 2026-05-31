-- Agent launch pipeline remediation (ticket 1:1288), Phase 3.
-- Guarantee at most ONE in-flight execution request per objective. This partial
-- unique index is the dedup mechanism for active requests (NOT the
-- idempotency_key, which stays non-deterministic so terminal-state
-- failed/launched rows can never block a legitimate relaunch).
--
-- "Active" = queued | claimed | launching. Terminal rows (launched, failed) are
-- intentionally excluded so a fresh Run after a real failure inserts a new row.
--
-- The application pre-checks for an active row and reuses it; this index is the
-- race backstop. A lost insert race raises 23505 on this index, which
-- createExecutionRequest catches and resolves by returning the existing active
-- row (reused: true).
create unique index if not exists execution_requests_active_objective_idx
  on public.execution_requests (objective_id)
  where status in ('queued', 'claimed', 'launching');

comment on index public.execution_requests_active_objective_idx is
  'At most one in-flight (queued/claimed/launching) execution request per objective. Active-request dedup for manual Run / relaunch (ticket 1:1288 Phase 3).';
