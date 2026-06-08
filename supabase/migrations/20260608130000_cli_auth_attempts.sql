-- cli_auth_attempts: abuse controls for the public CLI account-creation and
-- email-code login endpoints (/api/auth/cli-signup/* and /api/auth/cli-login/*).
--
-- Each row is one issuance/verification attempt, keyed by requester IP and the
-- normalized email. The endpoints count recent rows per IP and per email inside
-- a rolling window to rate-limit signup/login traffic, then insert the attempt.
-- Only the service-role client (which bypasses RLS) reads or writes this table;
-- no OTPs, passwords, or tokens are ever stored here.

CREATE TABLE IF NOT EXISTS public.cli_auth_attempts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT        NOT NULL,
  email         TEXT,
  requester_ip  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cli_auth_attempts_ip_created_idx
  ON public.cli_auth_attempts (requester_ip, created_at);

CREATE INDEX IF NOT EXISTS cli_auth_attempts_email_created_idx
  ON public.cli_auth_attempts (email, created_at);

-- Service-role only. RLS is enabled with no policies so the anon/authenticated
-- roles can never read or write attempt history.
ALTER TABLE public.cli_auth_attempts ENABLE ROW LEVEL SECURITY;
