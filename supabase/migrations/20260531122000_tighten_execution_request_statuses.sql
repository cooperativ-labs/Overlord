-- Agent launch pipeline remediation (ticket 1:1288), Phase 10.
-- Tighten execution_requests.status to only the values the runtime writes:
--   queued | claimed | launching | launched | failed
-- `cancelled` and `expired` were never written by the runtime and made the
-- lifecycle harder to reason about. Fold any existing rows into `failed`, but
-- PRESERVE the original status in last_error so the cancel-vs-fail distinction
-- stays recoverable for a future explicit cancellation feature.

update public.execution_requests
  set status = 'failed',
      last_error = coalesce(last_error, 'Execution request expired.')
  where status = 'expired';

update public.execution_requests
  set status = 'failed',
      last_error = coalesce(last_error, 'Execution request cancelled.')
  where status = 'cancelled';

alter table public.execution_requests
  drop constraint if exists execution_requests_status_check;

alter table public.execution_requests
  add constraint execution_requests_status_check check (
    status in ('queued', 'claimed', 'launching', 'launched', 'failed')
  );
