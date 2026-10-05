-- Overlord assistant conversations, account connections, and owner-addressed
-- conversation notifications (coo:1108, contract 152).
--
-- Every chat row belongs to one owner profile inside one organization and
-- cascades from that profile, so account deletion removes it with the identity.
-- Missions created from a proposal keep only a soft thread reference.
-- Provider checkpoints, tool results, and credential envelopes are private
-- server state: no DTO, realtime frame, change row, or log may carry them.
PRAGMA foreign_keys = ON;
BEGIN;

-- Account connections --------------------------------------------------------

CREATE TABLE account_connections (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('knowledgebase')),
  server_url TEXT NOT NULL CHECK (server_url LIKE 'https://%'),
  state TEXT NOT NULL CHECK (state IN ('pending', 'connected', 'reauthorization_required', 'disconnected')),
  authorized_workspaces_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(authorized_workspaces_json)),
  tool_policy_version INTEGER NOT NULL DEFAULT 1 CHECK (tool_policy_version >= 1),
  credential_ciphertext TEXT,
  credential_key_id TEXT,
  credential_revision INTEGER NOT NULL DEFAULT 0 CHECK (credential_revision >= 0),
  access_expires_at TEXT CHECK (access_expires_at IS NULL OR access_expires_at GLOB '????-??-??T??:??:??.???Z'),
  refresh_expires_at TEXT CHECK (refresh_expires_at IS NULL OR refresh_expires_at GLOB '????-??-??T??:??:??.???Z'),
  refresh_lock_owner TEXT,
  refresh_lock_until TEXT CHECK (refresh_lock_until IS NULL OR refresh_lock_until GLOB '????-??-??T??:??:??.???Z'),
  last_refreshed_at TEXT CHECK (last_refreshed_at IS NULL OR last_refreshed_at GLOB '????-??-??T??:??:??.???Z'),
  last_error_code TEXT,
  connected_at TEXT CHECK (connected_at IS NULL OR connected_at GLOB '????-??-??T??:??:??.???Z'),
  disconnected_at TEXT CHECK (disconnected_at IS NULL OR disconnected_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (state <> 'connected' OR credential_ciphertext IS NOT NULL),
  CHECK (state <> 'disconnected' OR (credential_ciphertext IS NULL AND disconnected_at IS NOT NULL)),
  CHECK ((credential_ciphertext IS NULL) = (credential_key_id IS NULL))
);
CREATE UNIQUE INDEX idx_account_connections_live
  ON account_connections (owner_profile_id, organization_id, provider, server_url)
  WHERE state <> 'disconnected';
CREATE INDEX idx_account_connections_refresh_lock
  ON account_connections (refresh_lock_until) WHERE refresh_lock_owner IS NOT NULL;

CREATE TABLE account_connection_authorizations (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES account_connections (id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE CHECK (length(trim(state_hash)) > 0),
  pkce_verifier_ciphertext TEXT NOT NULL,
  return_to TEXT NOT NULL CHECK (return_to IN ('mobile', 'web')),
  expires_at TEXT NOT NULL CHECK (expires_at GLOB '????-??-??T??:??:??.???Z'),
  consumed_at TEXT CHECK (consumed_at IS NULL OR consumed_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z')
);
CREATE INDEX idx_account_connection_authorizations_connection
  ON account_connection_authorizations (connection_id, expires_at);

-- Threads -------------------------------------------------------------------

CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  title_source TEXT NOT NULL DEFAULT 'pending' CHECK (title_source IN ('pending', 'generated', 'user')),
  archived_at TEXT CHECK (archived_at IS NULL OR archived_at GLOB '????-??-??T??:??:??.???Z'),
  last_activity_at TEXT NOT NULL CHECK (last_activity_at GLOB '????-??-??T??:??:??.???Z'),
  last_event_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_event_seq >= 0),
  retained_from_seq INTEGER NOT NULL DEFAULT 1 CHECK (retained_from_seq >= 1),
  authorization_revision INTEGER NOT NULL DEFAULT 1 CHECK (authorization_revision >= 1),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (retained_from_seq <= last_event_seq + 1)
);
CREATE INDEX idx_chat_threads_owner_activity
  ON chat_threads (owner_profile_id, organization_id, archived_at, last_activity_at DESC);

-- Source identity and dependency sets ---------------------------------------

CREATE TABLE chat_source_refs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('knowledgebase', 'overlord', 'repository')),
  scope_key TEXT NOT NULL CHECK (length(trim(scope_key)) > 0),
  connection_id TEXT REFERENCES account_connections (id) ON DELETE SET NULL,
  workspace_id TEXT,
  project_id TEXT,
  execution_target_id TEXT,
  resource_key TEXT,
  locator_json TEXT NOT NULL CHECK (json_valid(locator_json)),
  source_revision TEXT,
  access_state TEXT NOT NULL CHECK (access_state IN ('authorized', 'revoked', 'unknown')),
  access_checked_at TEXT NOT NULL CHECK (access_checked_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (thread_id, scope_key)
);
CREATE INDEX idx_chat_source_refs_connection ON chat_source_refs (connection_id) WHERE connection_id IS NOT NULL;
CREATE INDEX idx_chat_source_refs_project ON chat_source_refs (project_id) WHERE project_id IS NOT NULL;

CREATE TABLE chat_dependency_sets (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  digest TEXT NOT NULL CHECK (length(trim(digest)) > 0),
  invalidated_at TEXT CHECK (invalidated_at IS NULL OR invalidated_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  UNIQUE (thread_id, digest)
);

CREATE TABLE chat_dependency_set_members (
  dependency_set_id TEXT NOT NULL REFERENCES chat_dependency_sets (id) ON DELETE CASCADE,
  source_ref_id TEXT NOT NULL REFERENCES chat_source_refs (id) ON DELETE CASCADE,
  PRIMARY KEY (dependency_set_id, source_ref_id)
);
CREATE INDEX idx_chat_dependency_set_members_source
  ON chat_dependency_set_members (source_ref_id, dependency_set_id);

-- Messages, runs, attempts --------------------------------------------------

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  state TEXT NOT NULL CHECK (state IN ('streaming', 'complete', 'interrupted')),
  blocks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blocks_json)),
  run_id TEXT REFERENCES chat_runs (id) ON DELETE SET NULL,
  answers_question_id TEXT REFERENCES chat_questions (id) ON DELETE SET NULL,
  client_request_id TEXT CHECK (client_request_id IS NULL OR length(trim(client_request_id)) > 0),
  dependency_set_id TEXT REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  invalidated_at TEXT CHECK (invalidated_at IS NULL OR invalidated_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (role = 'user' OR client_request_id IS NULL),
  CHECK (role = 'assistant' OR state = 'complete'),
  UNIQUE (thread_id, client_request_id)
);
CREATE INDEX idx_chat_messages_thread_created ON chat_messages (thread_id, created_at, id);
CREATE INDEX idx_chat_messages_dependency_set ON chat_messages (dependency_set_id) WHERE dependency_set_id IS NOT NULL;

CREATE TABLE chat_runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  trigger_message_id TEXT REFERENCES chat_messages (id) ON DELETE CASCADE,
  continued_from_run_id TEXT REFERENCES chat_runs (id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'waiting_user', 'completed', 'failed', 'cancelled')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('answered', 'allowance_exhausted')),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN (
    'provider_unavailable', 'rate_limited', 'context_limit', 'unsupported_capability',
    'interrupted', 'provider_error', 'source_access_lost'
  )),
  current_fence INTEGER NOT NULL DEFAULT 0 CHECK (current_fence >= 0),
  active_attempt_id TEXT,
  tool_call_count INTEGER NOT NULL DEFAULT 0 CHECK (tool_call_count >= 0),
  active_processing_ms INTEGER NOT NULL DEFAULT 0 CHECK (active_processing_ms >= 0),
  gathered_content_bytes INTEGER NOT NULL DEFAULT 0 CHECK (gathered_content_bytes >= 0),
  limits_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(limits_json)),
  cancel_requested_at TEXT CHECK (cancel_requested_at IS NULL OR cancel_requested_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  completed_at TEXT CHECK (completed_at IS NULL OR completed_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (trigger_message_id IS NOT NULL OR continued_from_run_id IS NOT NULL),
  CHECK ((state = 'completed') = (outcome IS NOT NULL)),
  CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
  CHECK ((state IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)),
  CHECK (state = 'running' OR active_attempt_id IS NULL)
);
CREATE UNIQUE INDEX idx_chat_runs_one_unfinished_per_thread
  ON chat_runs (thread_id) WHERE state IN ('queued', 'running', 'waiting_user');
CREATE UNIQUE INDEX idx_chat_runs_single_continuation
  ON chat_runs (continued_from_run_id) WHERE continued_from_run_id IS NOT NULL;
CREATE INDEX idx_chat_runs_thread_created ON chat_runs (thread_id, created_at);
CREATE INDEX idx_chat_runs_schedulable ON chat_runs (state, updated_at) WHERE state IN ('queued', 'running');

CREATE TABLE chat_run_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES chat_runs (id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  fence INTEGER NOT NULL CHECK (fence >= 1),
  state TEXT NOT NULL CHECK (state IN ('leased', 'released', 'succeeded', 'failed', 'fenced', 'cancelled')),
  recovery_mode TEXT NOT NULL CHECK (recovery_mode IN ('initial', 'checkpoint', 'fresh_generation')),
  provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  config_digest TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT CHECK (lease_expires_at IS NULL OR lease_expires_at GLOB '????-??-??T??:??:??.???Z'),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN (
    'provider_unavailable', 'rate_limited', 'context_limit', 'unsupported_capability',
    'interrupted', 'provider_error', 'source_access_lost'
  )),
  started_at TEXT NOT NULL CHECK (started_at GLOB '????-??-??T??:??:??.???Z'),
  ended_at TEXT CHECK (ended_at IS NULL OR ended_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (state <> 'leased' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND ended_at IS NULL)),
  CHECK (state = 'leased' OR ended_at IS NOT NULL),
  UNIQUE (run_id, attempt_number),
  UNIQUE (run_id, fence)
);
CREATE UNIQUE INDEX idx_chat_run_attempts_one_leased
  ON chat_run_attempts (run_id) WHERE state = 'leased';
CREATE INDEX idx_chat_run_attempts_lease_expiry
  ON chat_run_attempts (lease_expires_at) WHERE state = 'leased';

-- A new attempt must take exactly the run's next fence; the claim raises
-- chat_runs.current_fence in the same transaction.
CREATE TRIGGER trg_chat_run_attempts_fence BEFORE INSERT ON chat_run_attempts
FOR EACH ROW WHEN NEW.fence <> (SELECT current_fence FROM chat_runs WHERE id = NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'chat attempt fence must equal the run current fence'); END;

CREATE TABLE chat_provider_checkpoints (
  run_id TEXT PRIMARY KEY REFERENCES chat_runs (id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES chat_run_attempts (id) ON DELETE CASCADE,
  fence INTEGER NOT NULL CHECK (fence >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('tool_requested', 'tool_results_joined')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  dependency_set_id TEXT REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  invalidated_at TEXT CHECK (invalidated_at IS NULL OR invalidated_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

-- Lease loss rejects checkpoint writes: only the run's current fence may write.
CREATE TRIGGER trg_chat_provider_checkpoints_fence_insert BEFORE INSERT ON chat_provider_checkpoints
FOR EACH ROW WHEN NEW.fence <> (SELECT current_fence FROM chat_runs WHERE id = NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'stale chat fence'); END;
CREATE TRIGGER trg_chat_provider_checkpoints_fence_update BEFORE UPDATE ON chat_provider_checkpoints
FOR EACH ROW WHEN NEW.fence <> (SELECT current_fence FROM chat_runs WHERE id = NEW.run_id)
  AND (NEW.payload_json IS NOT OLD.payload_json OR NEW.phase IS NOT OLD.phase
       OR NEW.fence IS NOT OLD.fence OR NEW.attempt_id IS NOT OLD.attempt_id)
BEGIN SELECT RAISE(ABORT, 'stale chat fence'); END;

CREATE TABLE chat_tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES chat_runs (id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES chat_run_attempts (id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE CHECK (length(trim(operation_id)) > 0),
  turn_index INTEGER NOT NULL CHECK (turn_index >= 0),
  call_order INTEGER NOT NULL CHECK (call_order >= 0),
  provider_call_id TEXT,
  tool_id TEXT NOT NULL CHECK (length(trim(tool_id)) > 0),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  arguments_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(arguments_json)),
  state TEXT NOT NULL CHECK (state IN ('requested', 'executing', 'completed', 'failed', 'cancelled')),
  executions INTEGER NOT NULL DEFAULT 0 CHECK (executions >= 0),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  result_bytes INTEGER CHECK (result_bytes IS NULL OR result_bytes >= 0),
  result_truncated INTEGER NOT NULL DEFAULT 0 CHECK (result_truncated IN (0, 1)),
  error_code TEXT,
  requested_fence INTEGER NOT NULL CHECK (requested_fence >= 1),
  writer_fence INTEGER NOT NULL CHECK (writer_fence >= requested_fence),
  dependency_set_id TEXT REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  completed_at TEXT CHECK (completed_at IS NULL OR completed_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK ((state IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)),
  UNIQUE (run_id, turn_index, call_order)
);

-- The requesting attempt and every later writer must hold the run's current
-- fence; a re-executing recovery attempt stamps its own fence as writer_fence.
-- Service cancellation is the one fence-free transition.
CREATE TRIGGER trg_chat_tool_calls_fence_insert BEFORE INSERT ON chat_tool_calls
FOR EACH ROW WHEN NEW.requested_fence <> (SELECT current_fence FROM chat_runs WHERE id = NEW.run_id)
  OR NEW.writer_fence <> NEW.requested_fence
BEGIN SELECT RAISE(ABORT, 'stale chat fence'); END;
CREATE TRIGGER trg_chat_tool_calls_fence_update BEFORE UPDATE ON chat_tool_calls
FOR EACH ROW WHEN NEW.state <> 'cancelled'
  AND NEW.writer_fence <> (SELECT current_fence FROM chat_runs WHERE id = NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'stale chat fence'); END;

CREATE TABLE chat_evidence (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  run_id TEXT REFERENCES chat_runs (id) ON DELETE SET NULL,
  tool_call_id TEXT REFERENCES chat_tool_calls (id) ON DELETE SET NULL,
  source_ref_id TEXT NOT NULL REFERENCES chat_source_refs (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  excerpt TEXT,
  excerpt_truncated INTEGER NOT NULL DEFAULT 0 CHECK (excerpt_truncated IN (0, 1)),
  source_revision TEXT,
  observed_at TEXT NOT NULL CHECK (observed_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z')
);
CREATE INDEX idx_chat_evidence_thread ON chat_evidence (thread_id, created_at);
CREATE INDEX idx_chat_evidence_source ON chat_evidence (source_ref_id);

CREATE TABLE chat_thread_summaries (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  summary_revision INTEGER NOT NULL CHECK (summary_revision >= 1),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  covers_through_message_id TEXT REFERENCES chat_messages (id) ON DELETE SET NULL,
  dependency_set_id TEXT REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  invalidated_at TEXT CHECK (invalidated_at IS NULL OR invalidated_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  UNIQUE (thread_id, summary_revision)
);

-- Questions -------------------------------------------------------------------

CREATE TABLE chat_questions (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES chat_runs (id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'superseded', 'cancelled')),
  prompt TEXT NOT NULL CHECK (length(trim(prompt)) > 0),
  options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
  allow_free_text INTEGER NOT NULL DEFAULT 1 CHECK (allow_free_text IN (0, 1)),
  answer_message_id TEXT REFERENCES chat_messages (id) ON DELETE SET NULL,
  dependency_set_id TEXT REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  answered_at TEXT CHECK (answered_at IS NULL OR answered_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK ((state = 'answered') = (answered_at IS NOT NULL)),
  UNIQUE (run_id, ordinal)
);
CREATE UNIQUE INDEX idx_chat_questions_one_open_per_run ON chat_questions (run_id) WHERE state = 'open';
CREATE INDEX idx_chat_questions_thread ON chat_questions (thread_id, state);

-- Ordered private event channel ------------------------------------------------

CREATE TABLE chat_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL CHECK (kind IN (
    'thread.updated', 'message.created', 'message.delta', 'message.completed', 'run.updated',
    'tool.updated', 'question.opened', 'question.closed', 'proposal.revised', 'proposal.created',
    'content.invalidated'
  )),
  run_id TEXT REFERENCES chat_runs (id) ON DELETE SET NULL,
  attempt_id TEXT,
  fence INTEGER CHECK (fence IS NULL OR fence >= 1),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  dependency_set_id TEXT REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK ((attempt_id IS NULL) = (fence IS NULL)),
  CHECK (fence IS NULL OR run_id IS NOT NULL),
  UNIQUE (thread_id, seq)
);

-- Storage is gap-free: a writer allocates by advancing chat_threads.last_event_seq
-- and inserts exactly that sequence in the same transaction.
CREATE TRIGGER trg_chat_events_seq BEFORE INSERT ON chat_events
FOR EACH ROW WHEN NEW.seq <> (SELECT last_event_seq FROM chat_threads WHERE id = NEW.thread_id)
BEGIN SELECT RAISE(ABORT, 'chat event seq must equal the thread last_event_seq'); END;
CREATE TRIGGER trg_chat_events_fence BEFORE INSERT ON chat_events
FOR EACH ROW WHEN NEW.fence IS NOT NULL
  AND NEW.fence <> (SELECT current_fence FROM chat_runs WHERE id = NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'stale chat fence'); END;
CREATE TRIGGER trg_chat_events_append_only BEFORE UPDATE ON chat_events
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'chat events are append-only'); END;

-- Proposals and creation receipts -------------------------------------------

CREATE TABLE chat_work_proposals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('open', 'created', 'cancelled')),
  current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
  created_by_run_id TEXT REFERENCES chat_runs (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE INDEX idx_chat_work_proposals_thread ON chat_work_proposals (thread_id, state);

CREATE TABLE chat_work_proposal_revisions (
  proposal_id TEXT NOT NULL REFERENCES chat_work_proposals (id) ON DELETE CASCADE,
  proposal_revision INTEGER NOT NULL CHECK (proposal_revision >= 1),
  spec_json TEXT NOT NULL CHECK (json_valid(spec_json)),
  responsible_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  run_id TEXT REFERENCES chat_runs (id) ON DELETE SET NULL,
  dependency_set_id TEXT REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  invalidated_at TEXT CHECK (invalidated_at IS NULL OR invalidated_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY (proposal_id, proposal_revision)
);
CREATE TRIGGER trg_chat_work_proposal_revisions_frozen BEFORE UPDATE OF spec_json, responsible_profile_id, proposal_revision ON chat_work_proposal_revisions
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'chat proposal revisions are frozen'); END;

CREATE TABLE chat_work_receipts (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE,
  proposal_revision INTEGER NOT NULL,
  owner_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL CHECK (length(trim(client_request_id)) > 0),
  request_digest TEXT NOT NULL,
  authorization_revision INTEGER NOT NULL CHECK (authorization_revision >= 1),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  UNIQUE (owner_profile_id, client_request_id),
  FOREIGN KEY (proposal_id, proposal_revision)
    REFERENCES chat_work_proposal_revisions (proposal_id, proposal_revision) ON DELETE CASCADE
);

CREATE TABLE chat_work_receipt_missions (
  receipt_id TEXT NOT NULL REFERENCES chat_work_receipts (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  mission_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  objective_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(objective_ids_json)),
  PRIMARY KEY (receipt_id, position)
);

-- Created drafts keep a soft reference to their source thread (no FK, so
-- account deletion and thread removal never block or erase mission history).
ALTER TABLE missions ADD COLUMN created_from_chat_thread_id TEXT;

-- Foreground presence and rendered-event acknowledgements ----------------------

CREATE TABLE chat_presence (
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  client_id TEXT NOT NULL CHECK (length(trim(client_id)) > 0),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'web', 'desktop')),
  expires_at TEXT NOT NULL CHECK (expires_at GLOB '????-??-??T??:??:??.???Z'),
  released_at TEXT CHECK (released_at IS NULL OR released_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY (thread_id, client_id)
);

CREATE TABLE chat_event_acks (
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  client_id TEXT NOT NULL CHECK (length(trim(client_id)) > 0),
  acked_seq INTEGER NOT NULL CHECK (acked_seq >= 0),
  acked_at TEXT NOT NULL CHECK (acked_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY (thread_id, client_id)
);
CREATE TRIGGER trg_chat_event_acks_monotonic BEFORE UPDATE OF acked_seq ON chat_event_acks
FOR EACH ROW WHEN NEW.acked_seq < OLD.acked_seq
BEGIN SELECT RAISE(ABORT, 'chat acknowledgements are monotonic'); END;

-- Owner-addressed conversation notifications ------------------------------------
-- One row per qualifying run transition: the durable candidate, its dispatch
-- job state, and (once dispatched) its history entry.

CREATE TABLE chat_notifications (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES chat_runs (id) ON DELETE CASCADE,
  question_id TEXT REFERENCES chat_questions (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('chat_needs_answer', 'chat_finished')),
  transition_key TEXT NOT NULL CHECK (length(trim(transition_key)) > 0),
  event_seq INTEGER NOT NULL CHECK (event_seq >= 1),
  state TEXT NOT NULL CHECK (state IN ('pending', 'suppressed', 'dispatching', 'dispatched', 'cancelled', 'failed')),
  due_at TEXT NOT NULL CHECK (due_at GLOB '????-??-??T??:??:??.???Z'),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  locked_by TEXT,
  locked_until TEXT CHECK (locked_until IS NULL OR locked_until GLOB '????-??-??T??:??:??.???Z'),
  suppressed_by_client_id TEXT,
  suppressed_at TEXT CHECK (suppressed_at IS NULL OR suppressed_at GLOB '????-??-??T??:??:??.???Z'),
  dispatched_at TEXT CHECK (dispatched_at IS NULL OR dispatched_at GLOB '????-??-??T??:??:??.???Z'),
  thread_title TEXT CHECK (thread_title IS NULL OR length(thread_title) <= 80),
  read_at TEXT CHECK (read_at IS NULL OR read_at GLOB '????-??-??T??:??:??.???Z'),
  last_error TEXT,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK ((type = 'chat_needs_answer') = (question_id IS NOT NULL)),
  CHECK ((state = 'suppressed') = (suppressed_at IS NOT NULL)),
  CHECK ((state = 'dispatched') = (dispatched_at IS NOT NULL)),
  CHECK (state = 'dispatched' OR read_at IS NULL),
  CHECK (state <> 'dispatching' OR (locked_by IS NOT NULL AND locked_until IS NOT NULL)),
  UNIQUE (owner_profile_id, thread_id, run_id, type, transition_key)
);
CREATE INDEX idx_chat_notifications_due ON chat_notifications (state, due_at) WHERE state IN ('pending', 'dispatching');
CREATE INDEX idx_chat_notifications_history
  ON chat_notifications (owner_profile_id, organization_id, deleted_at, dispatched_at DESC)
  WHERE state = 'dispatched';
CREATE INDEX idx_chat_notifications_thread_pending ON chat_notifications (thread_id, state, event_seq);

CREATE TRIGGER trg_chat_notifications_owner BEFORE INSERT ON chat_notifications
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM chat_threads t
   JOIN chat_runs r ON r.id = NEW.run_id AND r.thread_id = t.id
   WHERE t.id = NEW.thread_id
     AND t.owner_profile_id = NEW.owner_profile_id
     AND t.organization_id = NEW.organization_id
) OR (NEW.question_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM chat_questions q WHERE q.id = NEW.question_id AND q.run_id = NEW.run_id
))
BEGIN SELECT RAISE(ABORT, 'chat notification must address its thread owner, run, and question'); END;

-- Notification preferences: admit the two conversation catalog types ---------

CREATE TABLE notification_preferences_next (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'all',
      'mission_awaiting_review',
      'agent_question',
      'mission_complete',
      'mission_failed',
      'agent_started',
      'returned_to_execute',
      'chat_needs_answer',
      'chat_finished'
    )
  ),
  transport TEXT NOT NULL CHECK (transport IN ('all', 'apns', 'realtime', 'in_app')),
  mode TEXT NOT NULL CHECK (mode IN ('alert', 'silent', 'off')),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (
    (type = 'all' AND transport = 'all' AND mode IN ('alert', 'off'))
    OR (type <> 'all' AND transport <> 'all')
  ),
  UNIQUE (profile_id, type, transport)
);
INSERT INTO notification_preferences_next (id, profile_id, type, transport, mode, created_at, updated_at)
SELECT id, profile_id, type, transport, mode, created_at, updated_at FROM notification_preferences;
DROP TABLE notification_preferences;
ALTER TABLE notification_preferences_next RENAME TO notification_preferences;

COMMIT;
