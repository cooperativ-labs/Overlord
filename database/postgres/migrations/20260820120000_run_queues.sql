-- Project-scoped Run Queue engine (contract v102).
BEGIN;

CREATE TABLE run_queues (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) > 0),
  position double precision NOT NULL,
  paused boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_by_workspace_user_id text REFERENCES workspace_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_run_queues_project_default ON run_queues (project_id) WHERE is_default AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_run_queues_project_name ON run_queues (project_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_run_queues_project_position ON run_queues (project_id, position) WHERE deleted_at IS NULL;

CREATE TABLE run_queue_entries (
  id text PRIMARY KEY,
  queue_id text NOT NULL REFERENCES run_queues (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  mission_id text NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  position double precision NOT NULL,
  state text NOT NULL CHECK (state IN ('waiting', 'blocked', 'dispatched', 'running')),
  blocked_reason text,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  enqueued_by_workspace_user_id text REFERENCES workspace_users (id) ON DELETE SET NULL,
  enqueued_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  execution_request_id text REFERENCES execution_requests (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  FOREIGN KEY (project_id, queue_id) REFERENCES run_queues (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, mission_id) REFERENCES missions (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, objective_id) REFERENCES objectives (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, mission_id) REFERENCES missions (project_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_run_queue_entries_objective ON run_queue_entries (objective_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_run_queue_entries_queue_position ON run_queue_entries (queue_id, position) WHERE deleted_at IS NULL;
CREATE INDEX idx_run_queue_entries_project_position ON run_queue_entries (project_id, position) WHERE deleted_at IS NULL;
CREATE INDEX idx_run_queue_entries_mission_position ON run_queue_entries (mission_id, position) WHERE deleted_at IS NULL;

ALTER TABLE execution_requests ADD CONSTRAINT execution_requests_run_queue_idempotency
  CHECK (requested_source <> 'run_queue' OR idempotency_key IS NOT NULL);

INSERT INTO run_queues (id, project_id, workspace_id, name, position, paused, is_default, created_at, updated_at)
SELECT gen_random_uuid()::text, p.id, p.workspace_id, 'Run Queue', 1000, false, true,
       now(), now()
FROM projects p
WHERE p.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM objectives o WHERE o.project_id = p.id AND o.deleted_at IS NULL AND o.auto_advance = true
);

WITH chains AS (
  SELECT m.id mission_id, m.project_id, m.workspace_id, m.display_id,
         row_number() OVER (PARTITION BY m.project_id ORDER BY min(o.position), m.created_at, m.id) chain_rank
  FROM missions m JOIN objectives o ON o.mission_id = m.id
  WHERE m.deleted_at IS NULL AND o.deleted_at IS NULL AND o.auto_advance = true
  GROUP BY m.id, m.project_id, m.workspace_id, m.display_id
  HAVING count(*) >= 2
)
INSERT INTO run_queues (id, project_id, workspace_id, name, position, paused, is_default, created_at, updated_at)
SELECT gen_random_uuid()::text, project_id, workspace_id, 'Run Queue · ' || display_id,
       (chain_rank + 1) * 1000, false, false, now(), now()
FROM chains WHERE chain_rank > 1;

WITH mission_counts AS (
  SELECT m.id mission_id, m.project_id, m.created_at, count(*) chain_size, min(o.position) first_position
  FROM missions m JOIN objectives o ON o.mission_id = m.id
  WHERE m.deleted_at IS NULL AND o.deleted_at IS NULL AND o.auto_advance = true
  GROUP BY m.id, m.project_id, m.created_at
), chain_ranks AS (
  SELECT mission_id, project_id, chain_size,
         CASE WHEN chain_size >= 2 THEN sum(CASE WHEN chain_size >= 2 THEN 1 ELSE 0 END)
           OVER (PARTITION BY project_id ORDER BY first_position, created_at, mission_id) END chain_rank
  FROM mission_counts
), queued AS (
  SELECT o.*, cr.chain_size, cr.chain_rank, m.display_id mission_display_id,
         row_number() OVER (PARTITION BY o.project_id, CASE WHEN cr.chain_size >= 2 AND cr.chain_rank > 1 THEN o.mission_id ELSE '' END ORDER BY o.position, o.id) queue_rank
  FROM objectives o JOIN missions m ON m.id = o.mission_id JOIN chain_ranks cr ON cr.mission_id = o.mission_id
  WHERE o.deleted_at IS NULL AND o.auto_advance = true
)
INSERT INTO run_queue_entries (id, queue_id, project_id, workspace_id, mission_id, objective_id, position, state,
  enqueued_by_workspace_user_id, enqueued_at, created_at, updated_at)
SELECT gen_random_uuid()::text,
       CASE WHEN q.chain_size >= 2 AND q.chain_rank > 1
         THEN (SELECT rq.id FROM run_queues rq WHERE rq.project_id = q.project_id AND rq.name = 'Run Queue · ' || q.mission_display_id AND rq.deleted_at IS NULL)
         ELSE (SELECT rq.id FROM run_queues rq WHERE rq.project_id = q.project_id AND rq.is_default AND rq.deleted_at IS NULL) END,
       q.project_id, q.workspace_id, q.mission_id, q.id, q.queue_rank * 1000, 'waiting',
       q.created_by_workspace_user_id, now(), now(), now()
FROM queued q;

COMMIT;
