-- Overlord assistant conversations, account connections, and owner-addressed
-- conversation notifications (coo:1108, contract 152). Postgres counterpart of
-- database/sqlite/migrations/20261004120000_chat_conversations.sql; the trigger
-- functions below give the SQLite triggers identical semantics.
--
-- Every chat row belongs to one owner profile inside one organization and
-- cascades from that profile, so account deletion removes it with the identity.
-- Missions created from a proposal keep only a soft thread reference.
-- Provider checkpoints, tool results, and credential envelopes are private
-- server state: no DTO, realtime frame, change row, or log may carry them.
BEGIN;

-- Account connections --------------------------------------------------------

CREATE TABLE account_connections (
  id text PRIMARY KEY,
  owner_profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('knowledgebase')),
  server_url text NOT NULL CHECK (server_url LIKE 'https://%'),
  state text NOT NULL CHECK (state IN ('pending', 'connected', 'reauthorization_required', 'disconnected')),
  authorized_workspaces_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_policy_version integer NOT NULL DEFAULT 1 CHECK (tool_policy_version >= 1),
  credential_ciphertext text,
  credential_key_id text,
  credential_revision integer NOT NULL DEFAULT 0 CHECK (credential_revision >= 0),
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  refresh_lock_owner text,
  refresh_lock_until timestamptz,
  last_refreshed_at timestamptz,
  last_error_code text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
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
  id text PRIMARY KEY,
  connection_id text NOT NULL REFERENCES account_connections (id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE CHECK (char_length(btrim(state_hash)) > 0),
  pkce_verifier_ciphertext text NOT NULL,
  return_to text NOT NULL CHECK (return_to IN ('mobile', 'web')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_account_connection_authorizations_connection
  ON account_connection_authorizations (connection_id, expires_at);

-- Threads -------------------------------------------------------------------

CREATE TABLE chat_threads (
  id text PRIMARY KEY,
  owner_profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  title_source text NOT NULL DEFAULT 'pending' CHECK (title_source IN ('pending', 'generated', 'user')),
  archived_at timestamptz,
  last_activity_at timestamptz NOT NULL,
  last_event_seq bigint NOT NULL DEFAULT 0 CHECK (last_event_seq >= 0),
  retained_from_seq bigint NOT NULL DEFAULT 1 CHECK (retained_from_seq >= 1),
  authorization_revision integer NOT NULL DEFAULT 1 CHECK (authorization_revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (retained_from_seq <= last_event_seq + 1)
);
CREATE INDEX idx_chat_threads_owner_activity
  ON chat_threads (owner_profile_id, organization_id, archived_at, last_activity_at DESC);

-- Source identity and dependency sets ---------------------------------------

CREATE TABLE chat_source_refs (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('knowledgebase', 'overlord', 'repository')),
  scope_key text NOT NULL CHECK (char_length(btrim(scope_key)) > 0),
  connection_id text REFERENCES account_connections (id) ON DELETE SET NULL,
  workspace_id text,
  project_id text,
  execution_target_id text,
  resource_key text,
  locator_json jsonb NOT NULL,
  source_revision text,
  access_state text NOT NULL CHECK (access_state IN ('authorized', 'revoked', 'unknown')),
  access_checked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (thread_id, scope_key)
);
CREATE INDEX idx_chat_source_refs_connection ON chat_source_refs (connection_id) WHERE connection_id IS NOT NULL;
CREATE INDEX idx_chat_source_refs_project ON chat_source_refs (project_id) WHERE project_id IS NOT NULL;

CREATE TABLE chat_dependency_sets (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  digest text NOT NULL CHECK (char_length(btrim(digest)) > 0),
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (thread_id, digest)
);

CREATE TABLE chat_dependency_set_members (
  dependency_set_id text NOT NULL REFERENCES chat_dependency_sets (id) ON DELETE CASCADE,
  source_ref_id text NOT NULL REFERENCES chat_source_refs (id) ON DELETE CASCADE,
  PRIMARY KEY (dependency_set_id, source_ref_id)
);
CREATE INDEX idx_chat_dependency_set_members_source
  ON chat_dependency_set_members (source_ref_id, dependency_set_id);

-- Messages, runs, attempts --------------------------------------------------

CREATE TABLE chat_messages (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  state text NOT NULL CHECK (state IN ('streaming', 'complete', 'interrupted')),
  blocks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_id text,
  answers_question_id text,
  client_request_id text CHECK (client_request_id IS NULL OR char_length(btrim(client_request_id)) > 0),
  dependency_set_id text REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (role = 'user' OR client_request_id IS NULL),
  CHECK (role = 'assistant' OR state = 'complete'),
  UNIQUE (thread_id, client_request_id)
);
CREATE INDEX idx_chat_messages_thread_created ON chat_messages (thread_id, created_at, id);
CREATE INDEX idx_chat_messages_dependency_set ON chat_messages (dependency_set_id) WHERE dependency_set_id IS NOT NULL;

CREATE TABLE chat_runs (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  trigger_message_id text REFERENCES chat_messages (id) ON DELETE CASCADE,
  continued_from_run_id text REFERENCES chat_runs (id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('queued', 'running', 'waiting_user', 'completed', 'failed', 'cancelled')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('answered', 'allowance_exhausted')),
  failure_code text CHECK (failure_code IS NULL OR failure_code IN (
    'provider_unavailable', 'rate_limited', 'context_limit', 'unsupported_capability',
    'interrupted', 'provider_error', 'source_access_lost'
  )),
  current_fence integer NOT NULL DEFAULT 0 CHECK (current_fence >= 0),
  active_attempt_id text,
  tool_call_count integer NOT NULL DEFAULT 0 CHECK (tool_call_count >= 0),
  active_processing_ms bigint NOT NULL DEFAULT 0 CHECK (active_processing_ms >= 0),
  gathered_content_bytes bigint NOT NULL DEFAULT 0 CHECK (gathered_content_bytes >= 0),
  limits_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
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

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES chat_runs (id) ON DELETE SET NULL;

CREATE TABLE chat_run_attempts (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES chat_runs (id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  fence integer NOT NULL CHECK (fence >= 1),
  state text NOT NULL CHECK (state IN ('leased', 'released', 'succeeded', 'failed', 'fenced', 'cancelled')),
  recovery_mode text NOT NULL CHECK (recovery_mode IN ('initial', 'checkpoint', 'fresh_generation')),
  provider text NOT NULL CHECK (char_length(btrim(provider)) > 0),
  model text NOT NULL CHECK (char_length(btrim(model)) > 0),
  config_digest text,
  lease_owner text,
  lease_expires_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code IN (
    'provider_unavailable', 'rate_limited', 'context_limit', 'unsupported_capability',
    'interrupted', 'provider_error', 'source_access_lost'
  )),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
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
CREATE FUNCTION chat_run_attempts_require_fence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fence IS DISTINCT FROM (SELECT current_fence FROM chat_runs WHERE id = NEW.run_id) THEN
    RAISE EXCEPTION 'chat attempt fence must equal the run current fence' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chat_run_attempts_fence BEFORE INSERT ON chat_run_attempts
FOR EACH ROW EXECUTE FUNCTION chat_run_attempts_require_fence();

CREATE TABLE chat_provider_checkpoints (
  run_id text PRIMARY KEY REFERENCES chat_runs (id) ON DELETE CASCADE,
  attempt_id text NOT NULL REFERENCES chat_run_attempts (id) ON DELETE CASCADE,
  fence integer NOT NULL CHECK (fence >= 1),
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  provider text NOT NULL,
  model text NOT NULL,
  config_digest text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('tool_requested', 'tool_results_joined')),
  payload_json jsonb NOT NULL,
  dependency_set_id text REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

-- Lease loss rejects checkpoint writes: only the run's current fence may write.
-- Invalidation-only updates (no payload/phase/fence/attempt change) bypass it.
CREATE FUNCTION chat_provider_checkpoints_require_fence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fence IS DISTINCT FROM (SELECT current_fence FROM chat_runs WHERE id = NEW.run_id)
     AND (TG_OP = 'INSERT'
          OR NEW.payload_json IS DISTINCT FROM OLD.payload_json
          OR NEW.phase IS DISTINCT FROM OLD.phase
          OR NEW.fence IS DISTINCT FROM OLD.fence
          OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id) THEN
    RAISE EXCEPTION 'stale chat fence' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chat_provider_checkpoints_fence BEFORE INSERT OR UPDATE ON chat_provider_checkpoints
FOR EACH ROW EXECUTE FUNCTION chat_provider_checkpoints_require_fence();

CREATE TABLE chat_tool_calls (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES chat_runs (id) ON DELETE CASCADE,
  attempt_id text NOT NULL REFERENCES chat_run_attempts (id) ON DELETE CASCADE,
  operation_id text NOT NULL UNIQUE CHECK (char_length(btrim(operation_id)) > 0),
  turn_index integer NOT NULL CHECK (turn_index >= 0),
  call_order integer NOT NULL CHECK (call_order >= 0),
  provider_call_id text,
  tool_id text NOT NULL CHECK (char_length(btrim(tool_id)) > 0),
  policy_version integer NOT NULL CHECK (policy_version >= 1),
  arguments_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL CHECK (state IN ('requested', 'executing', 'completed', 'failed', 'cancelled')),
  executions integer NOT NULL DEFAULT 0 CHECK (executions >= 0),
  result_json jsonb,
  result_bytes bigint CHECK (result_bytes IS NULL OR result_bytes >= 0),
  result_truncated boolean NOT NULL DEFAULT false,
  error_code text,
  requested_fence integer NOT NULL CHECK (requested_fence >= 1),
  writer_fence integer NOT NULL CHECK (writer_fence >= requested_fence),
  dependency_set_id text REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK ((state IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)),
  UNIQUE (run_id, turn_index, call_order)
);

-- The requesting attempt and every later writer must hold the run's current
-- fence; a re-executing recovery attempt stamps its own fence as writer_fence.
-- Service cancellation is the one fence-free transition.
CREATE FUNCTION chat_tool_calls_require_fence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_fence integer;
BEGIN
  SELECT current_fence INTO run_fence FROM chat_runs WHERE id = NEW.run_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_fence IS DISTINCT FROM run_fence OR NEW.writer_fence <> NEW.requested_fence THEN
      RAISE EXCEPTION 'stale chat fence' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.state <> 'cancelled' AND NEW.writer_fence IS DISTINCT FROM run_fence THEN
    RAISE EXCEPTION 'stale chat fence' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chat_tool_calls_fence BEFORE INSERT OR UPDATE ON chat_tool_calls
FOR EACH ROW EXECUTE FUNCTION chat_tool_calls_require_fence();

CREATE TABLE chat_evidence (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  run_id text REFERENCES chat_runs (id) ON DELETE SET NULL,
  tool_call_id text REFERENCES chat_tool_calls (id) ON DELETE SET NULL,
  source_ref_id text NOT NULL REFERENCES chat_source_refs (id) ON DELETE CASCADE,
  label text NOT NULL,
  excerpt text,
  excerpt_truncated boolean NOT NULL DEFAULT false,
  source_revision text,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_chat_evidence_thread ON chat_evidence (thread_id, created_at);
CREATE INDEX idx_chat_evidence_source ON chat_evidence (source_ref_id);

CREATE TABLE chat_thread_summaries (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  summary_revision integer NOT NULL CHECK (summary_revision >= 1),
  summary_json jsonb NOT NULL,
  covers_through_message_id text REFERENCES chat_messages (id) ON DELETE SET NULL,
  dependency_set_id text REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (thread_id, summary_revision)
);

-- Questions -------------------------------------------------------------------

CREATE TABLE chat_questions (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES chat_runs (id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  state text NOT NULL CHECK (state IN ('open', 'answered', 'superseded', 'cancelled')),
  prompt text NOT NULL CHECK (char_length(btrim(prompt)) > 0),
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  allow_free_text boolean NOT NULL DEFAULT true,
  answer_message_id text REFERENCES chat_messages (id) ON DELETE SET NULL,
  dependency_set_id text REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  answered_at timestamptz,
  updated_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK ((state = 'answered') = (answered_at IS NOT NULL)),
  UNIQUE (run_id, ordinal)
);
CREATE UNIQUE INDEX idx_chat_questions_one_open_per_run ON chat_questions (run_id) WHERE state = 'open';
CREATE INDEX idx_chat_questions_thread ON chat_questions (thread_id, state);

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_answers_question_id_fkey
  FOREIGN KEY (answers_question_id) REFERENCES chat_questions (id) ON DELETE SET NULL;

-- Ordered private event channel ------------------------------------------------

CREATE TABLE chat_events (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  seq bigint NOT NULL CHECK (seq >= 1),
  kind text NOT NULL CHECK (kind IN (
    'thread.updated', 'message.created', 'message.delta', 'message.completed', 'run.updated',
    'tool.updated', 'question.opened', 'question.closed', 'proposal.revised', 'proposal.created',
    'content.invalidated'
  )),
  run_id text REFERENCES chat_runs (id) ON DELETE SET NULL,
  attempt_id text,
  fence integer CHECK (fence IS NULL OR fence >= 1),
  payload_json jsonb NOT NULL,
  dependency_set_id text REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  CHECK ((attempt_id IS NULL) = (fence IS NULL)),
  CHECK (fence IS NULL OR run_id IS NOT NULL),
  UNIQUE (thread_id, seq)
);

-- Storage is gap-free: a writer allocates by advancing chat_threads.last_event_seq
-- and inserts exactly that sequence in the same transaction. Events are append-only;
-- retention deletes whole rows below chat_threads.retained_from_seq.
CREATE FUNCTION chat_events_require_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'chat events are append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.seq IS DISTINCT FROM (SELECT last_event_seq FROM chat_threads WHERE id = NEW.thread_id) THEN
    RAISE EXCEPTION 'chat event seq must equal the thread last_event_seq' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.fence IS NOT NULL
     AND NEW.fence IS DISTINCT FROM (SELECT current_fence FROM chat_runs WHERE id = NEW.run_id) THEN
    RAISE EXCEPTION 'stale chat fence' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chat_events_sequence BEFORE INSERT OR UPDATE ON chat_events
FOR EACH ROW EXECUTE FUNCTION chat_events_require_sequence();

-- Proposals and creation receipts -------------------------------------------

CREATE TABLE chat_work_proposals (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('open', 'created', 'cancelled')),
  current_revision integer NOT NULL CHECK (current_revision >= 1),
  created_by_run_id text REFERENCES chat_runs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE INDEX idx_chat_work_proposals_thread ON chat_work_proposals (thread_id, state);

CREATE TABLE chat_work_proposal_revisions (
  proposal_id text NOT NULL REFERENCES chat_work_proposals (id) ON DELETE CASCADE,
  proposal_revision integer NOT NULL CHECK (proposal_revision >= 1),
  spec_json jsonb NOT NULL,
  responsible_profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  run_id text REFERENCES chat_runs (id) ON DELETE SET NULL,
  dependency_set_id text REFERENCES chat_dependency_sets (id) ON DELETE SET NULL,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (proposal_id, proposal_revision)
);
CREATE FUNCTION chat_work_proposal_revisions_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.spec_json IS DISTINCT FROM OLD.spec_json
     OR NEW.responsible_profile_id IS DISTINCT FROM OLD.responsible_profile_id
     OR NEW.proposal_revision IS DISTINCT FROM OLD.proposal_revision THEN
    RAISE EXCEPTION 'chat proposal revisions are frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chat_work_proposal_revisions_frozen BEFORE UPDATE ON chat_work_proposal_revisions
FOR EACH ROW EXECUTE FUNCTION chat_work_proposal_revisions_frozen();

CREATE TABLE chat_work_receipts (
  id text PRIMARY KEY,
  proposal_id text NOT NULL UNIQUE,
  proposal_revision integer NOT NULL,
  owner_profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  client_request_id text NOT NULL CHECK (char_length(btrim(client_request_id)) > 0),
  request_digest text NOT NULL,
  authorization_revision integer NOT NULL CHECK (authorization_revision >= 1),
  created_at timestamptz NOT NULL,
  UNIQUE (owner_profile_id, client_request_id),
  FOREIGN KEY (proposal_id, proposal_revision)
    REFERENCES chat_work_proposal_revisions (proposal_id, proposal_revision) ON DELETE CASCADE
);

CREATE TABLE chat_work_receipt_missions (
  receipt_id text NOT NULL REFERENCES chat_work_receipts (id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  mission_id text NOT NULL UNIQUE,
  project_id text NOT NULL,
  workspace_id text NOT NULL,
  objective_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (receipt_id, position)
);

-- Created drafts keep a soft reference to their source thread (no FK, so
-- account deletion and thread removal never block or erase mission history).
ALTER TABLE missions ADD COLUMN created_from_chat_thread_id text;

-- Foreground presence and rendered-event acknowledgements ----------------------

CREATE TABLE chat_presence (
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  client_id text NOT NULL CHECK (char_length(btrim(client_id)) > 0),
  platform text NOT NULL CHECK (platform IN ('ios', 'web', 'desktop')),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (thread_id, client_id)
);

CREATE TABLE chat_event_acks (
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  client_id text NOT NULL CHECK (char_length(btrim(client_id)) > 0),
  acked_seq bigint NOT NULL CHECK (acked_seq >= 0),
  acked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (thread_id, client_id)
);
CREATE FUNCTION chat_event_acks_monotonic() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.acked_seq < OLD.acked_seq THEN
    RAISE EXCEPTION 'chat acknowledgements are monotonic' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chat_event_acks_monotonic BEFORE UPDATE ON chat_event_acks
FOR EACH ROW EXECUTE FUNCTION chat_event_acks_monotonic();

-- Owner-addressed conversation notifications ------------------------------------
-- One row per qualifying run transition: the durable candidate, its dispatch
-- job state, and (once dispatched) its history entry.

CREATE TABLE chat_notifications (
  id text PRIMARY KEY,
  owner_profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES chat_runs (id) ON DELETE CASCADE,
  question_id text REFERENCES chat_questions (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('chat_needs_answer', 'chat_finished')),
  transition_key text NOT NULL CHECK (char_length(btrim(transition_key)) > 0),
  event_seq bigint NOT NULL CHECK (event_seq >= 1),
  state text NOT NULL CHECK (state IN ('pending', 'suppressed', 'dispatching', 'dispatched', 'cancelled', 'failed')),
  due_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  locked_by text,
  locked_until timestamptz,
  suppressed_by_client_id text,
  suppressed_at timestamptz,
  dispatched_at timestamptz,
  thread_title text CHECK (thread_title IS NULL OR char_length(thread_title) <= 80),
  read_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
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

CREATE FUNCTION chat_notifications_require_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM chat_threads t
         JOIN chat_runs r ON r.id = NEW.run_id AND r.thread_id = t.id
        WHERE t.id = NEW.thread_id
          AND t.owner_profile_id = NEW.owner_profile_id
          AND t.organization_id = NEW.organization_id
     )
     OR (NEW.question_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM chat_questions q WHERE q.id = NEW.question_id AND q.run_id = NEW.run_id
     )) THEN
    RAISE EXCEPTION 'chat notification must address its thread owner, run, and question'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chat_notifications_owner BEFORE INSERT ON chat_notifications
FOR EACH ROW EXECUTE FUNCTION chat_notifications_require_owner();

-- Notification preferences: admit the two conversation catalog types ---------

ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_type_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_type_check CHECK (
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
);

COMMIT;
