-- Project-scoped Run Queue engine (contract v102).
PRAGMA foreign_keys = ON;
BEGIN;

CREATE TABLE run_queues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  position REAL NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_run_queues_project_default ON run_queues (project_id) WHERE is_default = 1 AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_run_queues_project_name ON run_queues (project_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE INDEX idx_run_queues_project_position ON run_queues (project_id, position) WHERE deleted_at IS NULL;

CREATE TABLE run_queue_entries (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES run_queues (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'blocked', 'dispatched', 'running')),
  blocked_reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  enqueued_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
  enqueued_at TEXT NOT NULL,
  dispatched_at TEXT,
  execution_request_id TEXT REFERENCES execution_requests (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
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

CREATE TRIGGER trg_execution_requests_run_queue_idempotency_insert
BEFORE INSERT ON execution_requests
WHEN new.requested_source = 'run_queue' AND new.idempotency_key IS NULL
BEGIN SELECT RAISE(ABORT, 'run_queue execution requests require idempotency_key'); END;
CREATE TRIGGER trg_execution_requests_run_queue_idempotency_update
BEFORE UPDATE OF requested_source, idempotency_key ON execution_requests
WHEN new.requested_source = 'run_queue' AND new.idempotency_key IS NULL
BEGIN SELECT RAISE(ABORT, 'run_queue execution requests require idempotency_key'); END;

INSERT INTO run_queues (id, project_id, workspace_id, name, position, paused, is_default, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.id, p.workspace_id, 'Run Queue', 1000, 0, 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM projects p
WHERE p.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM objectives o WHERE o.project_id = p.id AND o.deleted_at IS NULL AND o.auto_advance = 1
);

WITH chains AS (
  SELECT m.id mission_id, m.project_id, m.workspace_id, m.display_id,
         row_number() OVER (PARTITION BY m.project_id ORDER BY min(o.position), m.created_at, m.id) chain_rank
  FROM missions m JOIN objectives o ON o.mission_id = m.id
  WHERE m.deleted_at IS NULL AND o.deleted_at IS NULL AND o.auto_advance = 1
  GROUP BY m.id, m.project_id, m.workspace_id, m.display_id
  HAVING count(*) >= 2
)
INSERT INTO run_queues (id, project_id, workspace_id, name, position, paused, is_default, created_at, updated_at)
SELECT lower(hex(randomblob(16))), project_id, workspace_id, 'Run Queue · ' || display_id,
       (chain_rank + 1) * 1000, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM chains WHERE chain_rank > 1;

WITH mission_counts AS (
  SELECT m.id mission_id, m.project_id, m.created_at, count(*) chain_size, min(o.position) first_position
  FROM missions m JOIN objectives o ON o.mission_id = m.id
  WHERE m.deleted_at IS NULL AND o.deleted_at IS NULL AND o.auto_advance = 1
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
  WHERE o.deleted_at IS NULL AND o.auto_advance = 1
)
INSERT INTO run_queue_entries (id, queue_id, project_id, workspace_id, mission_id, objective_id, position, state,
  enqueued_by_workspace_user_id, enqueued_at, created_at, updated_at)
SELECT lower(hex(randomblob(16))),
       CASE WHEN q.chain_size >= 2 AND q.chain_rank > 1
         THEN (SELECT rq.id FROM run_queues rq WHERE rq.project_id = q.project_id AND rq.name = 'Run Queue · ' || q.mission_display_id AND rq.deleted_at IS NULL)
         ELSE (SELECT rq.id FROM run_queues rq WHERE rq.project_id = q.project_id AND rq.is_default = 1 AND rq.deleted_at IS NULL) END,
       q.project_id, q.workspace_id, q.mission_id, q.id, q.queue_rank * 1000, 'waiting',
       q.created_by_workspace_user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM queued q;

COMMIT;
