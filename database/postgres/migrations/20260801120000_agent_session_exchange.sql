-- Agent Session Exchange core tables (coo:562 phase 0B, contract 46)
--
-- The durable state behind session observation, answerable requests, and
-- inbound instructions. Declared by contract 45 and migrated here with the
-- channel bootstrap.
--
-- These are core rather than `ext_` tables because they drive authorization,
-- audit, presence, and UI gating.
--
-- Two shapes deserve explanation up front:
--
--   * `agent_session_channels.session_id` is NULLABLE and only becomes unique
--     once protocol attach binds it. A channel exists BEFORE the agent starts,
--     so there is nothing to point at yet; events published in that window stay
--     attached to the channel and become session events when binding completes.
--
--   * The scoped channel credential is stored hash-only, exactly like
--     `agent_sessions.session_key_hash` and `user_tokens.token_hash`. It is
--     scoped to one channel: it may append events, create requests, await
--     resolutions, claim and acknowledge inputs, and heartbeat. It may not read
--     other mission data, resolve a human decision, or perform normal mission
--     mutations. `lease_expires_at` bounds it; `credential_revoked_at` kills it
--     immediately on channel end or loss.
--
-- The never-migrated `hook_events` and `permission_requests` designs are
-- superseded rather than abandoned: sanitized hook events become normalized
-- `agent_session_events`, and a permission becomes one kind of `agent_requests`.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_session_channels (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id text REFERENCES projects (id) ON DELETE SET NULL,
  mission_id text REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text REFERENCES objectives (id) ON DELETE SET NULL,

  -- Null until protocol attach binds this channel to the session it prepared.
  session_id text REFERENCES agent_sessions (id) ON DELETE SET NULL,

  -- Launch provenance. Never routing: a channel is addressed by its own id.
  execution_request_id text REFERENCES execution_requests (id) ON DELETE SET NULL,
  execution_target_id text REFERENCES execution_targets (id) ON DELETE SET NULL,
  runner_registration_id text
    REFERENCES execution_target_runner_registrations (id) ON DELETE SET NULL,
  launch_kind text NOT NULL DEFAULT 'unknown',
  launch_prompt_id text,

  -- Translation owner.
  agent_identifier text,
  adapter_key text,
  adapter_version text,

  -- Harness correlation alias. NEVER an authorization key, and never unique:
  -- a harness may reuse or omit it, and possession of one grants nothing.
  native_session_id text,

  -- Effective runtime capability snapshot. Clients gate controls on this, never
  -- on the static connector catalog and never on the agent identifier.
  capabilities_json jsonb NOT NULL DEFAULT '{}'::jsonb,

  state text NOT NULL DEFAULT 'preparing'
    CHECK (state IN ('preparing', 'online', 'degraded', 'ended', 'lost')),

  -- Hash-only scoped credential. `credential_prefix` is the non-secret display
  -- and lookup prefix; the raw secret is never stored, logged, or returned
  -- after bootstrap.
  credential_prefix text,
  credential_hash text,
  credential_algorithm text NOT NULL DEFAULT 'sha256',
  credential_expires_at timestamptz,
  credential_revoked_at timestamptz,

  -- Presence. `online` means a lease is being renewed, not that the model is
  -- generating; `lost` means the lease expired without a clean end.
  last_heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  exit_code integer,

  created_by_workspace_user_id text REFERENCES workspace_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

-- One active root channel per Overlord agent session (§3.2). Partial so the
-- pre-attach window, where session_id is null, is unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asc_active_session
  ON agent_session_channels (session_id)
  WHERE session_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_asc_credential_hash
  ON agent_session_channels (credential_hash)
  WHERE credential_hash IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asc_mission_state
  ON agent_session_channels (workspace_id, mission_id, state, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_asc_execution_request
  ON agent_session_channels (execution_request_id)
  WHERE execution_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_session_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id text REFERENCES projects (id) ON DELETE SET NULL,
  mission_id text REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text REFERENCES objectives (id) ON DELETE SET NULL,
  channel_id text NOT NULL REFERENCES agent_session_channels (id) ON DELETE CASCADE,
  -- Denormalized at bind time so pre-attach events become session events.
  session_id text REFERENCES agent_sessions (id) ON DELETE SET NULL,

  adapter_key text NOT NULL,
  -- Adapter-stable producer id. Delivery is at least once; the unique index
  -- below is what makes replay idempotent.
  producer_event_id text NOT NULL,
  producer_sequence integer,
  -- Monotonic per channel, assigned by the server on append.
  channel_sequence integer NOT NULL,

  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,

  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'notice',
  actionability text,
  native_event text,
  native_turn_id text,
  native_call_id text,
  subagent_id text,
  correlation_id text,
  origin text,

  -- Bounded, redacted, formatter-versioned. Raw native payloads are never
  -- persisted: no transcripts or transcript paths, no raw tool input or output,
  -- no file contents, no environment variables.
  summary text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  formatter_version integer NOT NULL DEFAULT 1,

  -- Set when this event also projected a bounded mission timeline row.
  mission_event_id text REFERENCES mission_events (id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ase_producer_identity
  ON agent_session_events (channel_id, adapter_key, producer_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ase_channel_sequence
  ON agent_session_events (channel_id, channel_sequence);
CREATE INDEX IF NOT EXISTS idx_ase_session_occurred
  ON agent_session_events (session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ase_mission_occurred
  ON agent_session_events (workspace_id, mission_id, occurred_at);

CREATE TABLE IF NOT EXISTS agent_requests (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id text REFERENCES projects (id) ON DELETE SET NULL,
  mission_id text REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text REFERENCES objectives (id) ON DELETE SET NULL,
  channel_id text NOT NULL REFERENCES agent_session_channels (id) ON DELETE CASCADE,
  session_id text REFERENCES agent_sessions (id) ON DELETE SET NULL,
  source_event_id text REFERENCES agent_session_events (id) ON DELETE SET NULL,

  kind text NOT NULL CHECK (kind IN ('question', 'permission', 'choice', 'retry')),
  native_request_id text,
  native_call_id text,

  summary text NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  formatter_version integer NOT NULL DEFAULT 1,
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  allows_free_text boolean NOT NULL DEFAULT false,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'released_to_terminal', 'expired', 'cancelled')),
  resolution_json jsonb,
  resolved_by_workspace_user_id text REFERENCES workspace_users (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  expires_at timestamptz,

  -- Presence-driven remote window and why it was sized that way.
  window_expires_at timestamptz,
  window_basis text,
  first_viewed_at timestamptz,
  released_reason text,

  -- Waiter lease. If the CLI is killed before its cancellation write lands,
  -- lease expiry is what releases the request and closes remote controls, so a
  -- card can never stay answerable while the native prompt is already active.
  waiter_lease_id text,
  waiter_lease_expires_at timestamptz,

  application_state text NOT NULL DEFAULT 'pending'
    CHECK (application_state IN ('pending', 'emitted', 'applied', 'not_applied', 'unknown')),
  application_observed_at timestamptz,

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_areq_native_identity
  ON agent_requests (channel_id, native_request_id)
  WHERE native_request_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_areq_open_window
  ON agent_requests (workspace_id, status, window_expires_at);
CREATE INDEX IF NOT EXISTS idx_areq_session_created
  ON agent_requests (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_areq_channel_status
  ON agent_requests (channel_id, status);

CREATE TABLE IF NOT EXISTS agent_session_inputs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id text REFERENCES projects (id) ON DELETE SET NULL,
  mission_id text REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text REFERENCES objectives (id) ON DELETE SET NULL,
  channel_id text NOT NULL REFERENCES agent_session_channels (id) ON DELETE CASCADE,
  -- The session is required: an instruction with no session has no addressee.
  session_id text NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN ('instruction', 'retry', 'continue')),
  body text NOT NULL,
  idempotency_key text,
  created_by_workspace_user_id text REFERENCES workspace_users (id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'leased', 'emitted', 'acknowledged', 'failed', 'expired', 'cancelled'
    )),
  -- One adapter consumer at a time. Lease expiry permits reclaim only BEFORE
  -- `emitted`; after emission automatic retry is forbidden, because a duplicate
  -- model instruction is worse than an honest unknown.
  lease_id text,
  lease_expires_at timestamptz,
  emitted_at timestamptz,
  acknowledged_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text,

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asi_idempotency
  ON agent_session_inputs (session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asi_channel_status
  ON agent_session_inputs (channel_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_asi_lease_expiry
  ON agent_session_inputs (status, lease_expires_at);

COMMIT;
