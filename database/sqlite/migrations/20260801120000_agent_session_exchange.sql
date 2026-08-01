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

CREATE TABLE IF NOT EXISTS agent_session_channels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  mission_id TEXT REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT REFERENCES objectives (id) ON DELETE SET NULL,

  -- Null until protocol attach binds this channel to the session it prepared.
  session_id TEXT REFERENCES agent_sessions (id) ON DELETE SET NULL,

  -- Launch provenance. Never routing: a channel is addressed by its own id.
  execution_request_id TEXT REFERENCES execution_requests (id) ON DELETE SET NULL,
  execution_target_id TEXT REFERENCES execution_targets (id) ON DELETE SET NULL,
  runner_registration_id TEXT
    REFERENCES execution_target_runner_registrations (id) ON DELETE SET NULL,
  launch_kind TEXT NOT NULL DEFAULT 'unknown',
  launch_prompt_id TEXT,

  -- Translation owner.
  agent_identifier TEXT,
  adapter_key TEXT,
  adapter_version TEXT,

  -- Harness correlation alias. NEVER an authorization key, and never unique:
  -- a harness may reuse or omit it, and possession of one grants nothing.
  native_session_id TEXT,

  -- Effective runtime capability snapshot. Clients gate controls on this, never
  -- on the static connector catalog and never on the agent identifier.
  capabilities_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capabilities_json)),

  state TEXT NOT NULL DEFAULT 'preparing'
    CHECK (state IN ('preparing', 'online', 'degraded', 'ended', 'lost')),

  -- Hash-only scoped credential. `credential_prefix` is the non-secret display
  -- and lookup prefix; the raw secret is never stored, logged, or returned
  -- after bootstrap.
  credential_prefix TEXT,
  credential_hash TEXT,
  credential_algorithm TEXT NOT NULL DEFAULT 'sha256',
  credential_expires_at TEXT
    CHECK (credential_expires_at IS NULL OR credential_expires_at GLOB '????-??-??T??:??:??.???Z'),
  credential_revoked_at TEXT
    CHECK (credential_revoked_at IS NULL OR credential_revoked_at GLOB '????-??-??T??:??:??.???Z'),

  -- Presence. `online` means a lease is being renewed, not that the model is
  -- generating; `lost` means the lease expired without a clean end.
  last_heartbeat_at TEXT
    CHECK (last_heartbeat_at IS NULL OR last_heartbeat_at GLOB '????-??-??T??:??:??.???Z'),
  lease_expires_at TEXT
    CHECK (lease_expires_at IS NULL OR lease_expires_at GLOB '????-??-??T??:??:??.???Z'),
  ended_at TEXT CHECK (ended_at IS NULL OR ended_at GLOB '????-??-??T??:??:??.???Z'),
  end_reason TEXT,
  exit_code INTEGER,

  created_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
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
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  mission_id TEXT REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT REFERENCES objectives (id) ON DELETE SET NULL,
  channel_id TEXT NOT NULL REFERENCES agent_session_channels (id) ON DELETE CASCADE,
  -- Denormalized at bind time so pre-attach events become session events.
  session_id TEXT REFERENCES agent_sessions (id) ON DELETE SET NULL,

  adapter_key TEXT NOT NULL,
  -- Adapter-stable producer id. Delivery is at least once; the unique index
  -- below is what makes replay idempotent.
  producer_event_id TEXT NOT NULL,
  producer_sequence INTEGER,
  -- Monotonic per channel, assigned by the server on append.
  channel_sequence INTEGER NOT NULL,

  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  received_at TEXT NOT NULL CHECK (received_at GLOB '????-??-??T??:??:??.???Z'),

  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'notice',
  actionability TEXT,
  native_event TEXT,
  native_turn_id TEXT,
  native_call_id TEXT,
  subagent_id TEXT,
  correlation_id TEXT,
  origin TEXT,

  -- Bounded, redacted, formatter-versioned. Raw native payloads are never
  -- persisted: no transcripts or transcript paths, no raw tool input or output,
  -- no file contents, no environment variables.
  summary TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  formatter_version INTEGER NOT NULL DEFAULT 1,

  -- Set when this event also projected a bounded mission timeline row.
  mission_event_id TEXT REFERENCES mission_events (id) ON DELETE SET NULL,

  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
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
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  mission_id TEXT REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT REFERENCES objectives (id) ON DELETE SET NULL,
  channel_id TEXT NOT NULL REFERENCES agent_session_channels (id) ON DELETE CASCADE,
  session_id TEXT REFERENCES agent_sessions (id) ON DELETE SET NULL,
  source_event_id TEXT REFERENCES agent_session_events (id) ON DELETE SET NULL,

  kind TEXT NOT NULL CHECK (kind IN ('question', 'permission', 'choice', 'retry')),
  native_request_id TEXT,
  native_call_id TEXT,

  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  formatter_version INTEGER NOT NULL DEFAULT 1,
  options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
  allows_free_text INTEGER NOT NULL DEFAULT 0 CHECK (allows_free_text IN (0, 1)),

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'released_to_terminal', 'expired', 'cancelled')),
  resolution_json TEXT CHECK (resolution_json IS NULL OR json_valid(resolution_json)),
  resolved_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
  resolved_at TEXT CHECK (resolved_at IS NULL OR resolved_at GLOB '????-??-??T??:??:??.???Z'),
  expires_at TEXT CHECK (expires_at IS NULL OR expires_at GLOB '????-??-??T??:??:??.???Z'),

  -- Presence-driven remote window and why it was sized that way.
  window_expires_at TEXT
    CHECK (window_expires_at IS NULL OR window_expires_at GLOB '????-??-??T??:??:??.???Z'),
  window_basis TEXT,
  first_viewed_at TEXT
    CHECK (first_viewed_at IS NULL OR first_viewed_at GLOB '????-??-??T??:??:??.???Z'),
  released_reason TEXT,

  -- Waiter lease. If the CLI is killed before its cancellation write lands,
  -- lease expiry is what releases the request and closes remote controls, so a
  -- card can never stay answerable while the native prompt is already active.
  waiter_lease_id TEXT,
  waiter_lease_expires_at TEXT
    CHECK (waiter_lease_expires_at IS NULL
           OR waiter_lease_expires_at GLOB '????-??-??T??:??:??.???Z'),

  application_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (application_state IN ('pending', 'emitted', 'applied', 'not_applied', 'unknown')),
  application_observed_at TEXT
    CHECK (application_observed_at IS NULL
           OR application_observed_at GLOB '????-??-??T??:??:??.???Z'),

  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
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
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  mission_id TEXT REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT REFERENCES objectives (id) ON DELETE SET NULL,
  channel_id TEXT NOT NULL REFERENCES agent_session_channels (id) ON DELETE CASCADE,
  -- The session is required: an instruction with no session has no addressee.
  session_id TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN ('instruction', 'retry', 'continue')),
  body TEXT NOT NULL,
  idempotency_key TEXT,
  created_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'leased', 'emitted', 'acknowledged', 'failed', 'expired', 'cancelled'
    )),
  -- One adapter consumer at a time. Lease expiry permits reclaim only BEFORE
  -- `emitted`; after emission automatic retry is forbidden, because a duplicate
  -- model instruction is worse than an honest unknown.
  lease_id TEXT,
  lease_expires_at TEXT
    CHECK (lease_expires_at IS NULL OR lease_expires_at GLOB '????-??-??T??:??:??.???Z'),
  emitted_at TEXT CHECK (emitted_at IS NULL OR emitted_at GLOB '????-??-??T??:??:??.???Z'),
  acknowledged_at TEXT
    CHECK (acknowledged_at IS NULL OR acknowledged_at GLOB '????-??-??T??:??:??.???Z'),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,

  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asi_idempotency
  ON agent_session_inputs (session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asi_channel_status
  ON agent_session_inputs (channel_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_asi_lease_expiry
  ON agent_session_inputs (status, lease_expires_at);
