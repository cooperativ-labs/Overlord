import type { DatabaseClient } from './client.js';

/**
 * Fixture mission for the `mission_items` backfill (coo:1260, ADR 0060), shared
 * by the SQLite and Postgres migration tests and the core comparison test.
 * Seeded on a database migrated up to, but not including,
 * `20261115120000_mission_items`.
 *
 * - Objective `oa` delivered twice (`dA1`, then `dA2`); `dA2` is a composed
 *   presentation whose human action is reworded from the agent's text and
 *   which carries a `deterministic_rule` action. A later delivery `dDel` of
 *   `oa` is deleted, and an earlier `dBad` has a report that fails the strict
 *   schema.
 * - Objective `ob` delivered `dB1`, was reopened, then delivered `dB2`.
 * - Objective `oc` is deleted; its delivery `dC1` is still live.
 * - Resolutions: `sA1` promoted to a mission, `sB1` dismissed, `sC1` added as
 *   an objective, and one orphan row that names no suggestion.
 */

export const FIXTURE_IDS = {
  workspaceId: 'w-items',
  projectId: 'p-items',
  missionId: 'm-items',
  otherMissionId: 'm-items-other'
} as const;

const T = {
  t0: '2026-11-01T00:00:00.000Z',
  t1: '2026-11-02T00:00:00.000Z',
  t2: '2026-11-03T00:00:00.000Z',
  t2b: '2026-11-03T12:00:00.000Z',
  t3: '2026-11-04T00:00:00.000Z',
  t4: '2026-11-05T00:00:00.000Z',
  t5: '2026-11-06T00:00:00.000Z'
};

type Action = {
  id: string;
  action: string;
  category: string;
  source: 'agent' | 'deterministic_rule';
  blocking?: boolean;
  sourceRef?: string;
  link?: string;
};
type Deferred = { id: string; title: string; change: string; location: string; doneWhen: string };

function deferred(id: string, title: string): Deferred {
  return {
    id,
    title,
    change: `Change for ${title}.`,
    location: 'backend/example.ts',
    doneWhen: `${title} is done.`
  };
}

export const SUGGESTIONS = {
  sA1: deferred('deferred-work-0-a1a1a1a1a1a1a1a1', 'Add retry metrics'),
  sA2: deferred('deferred-work-1-a2a2a2a2a2a2a2a2', 'Document the flag'),
  sA3: deferred('deferred-work-0-a3a3a3a3a3a3a3a3', 'Split the worker'),
  sB1: deferred('deferred-work-0-b1b1b1b1b1b1b1b1', 'Remove the old route'),
  sB2: deferred('deferred-work-1-b2b2b2b2b2b2b2b2', 'Rename the table'),
  sC1: deferred('deferred-work-0-c1c1c1c1c1c1c1c1', 'Backfill the cache')
};

function report({
  agentActions = [],
  actions = agentActions,
  risks = [],
  suggestions = [],
  composed = false
}: {
  agentActions?: Action[];
  actions?: Action[];
  risks?: string[];
  suggestions?: Deferred[];
  composed?: boolean;
}) {
  return {
    schemaVersion: 1,
    agentReport: {
      humanActions: agentActions,
      tradeoffsMade: [],
      knownRisks: risks,
      deferredWork: suggestions,
      assumptions: []
    },
    presentation: {
      status: composed ? 'composed' : 'deterministic',
      markdown: 'Delivered.',
      humanActions: actions,
      tradeoffsMade: [],
      knownRisks: risks,
      deferredWork: suggestions,
      assumptions: [],
      generatedBy: composed ? 'gemini' : 'deterministic',
      ...(composed ? { generatedAt: T.t2, model: 'test-model' } : {})
    }
  };
}

const ruleAction: Action = {
  id: 'rule-action-1',
  action: 'Apply the database migration(s) included in this delivery.',
  category: 'database',
  source: 'deterministic_rule',
  sourceRef: 'database/x.sql',
  link: 'database/x.sql'
};

interface FixtureDelivery {
  id: string;
  objectiveId: string;
  deliveredAt: string;
  deleted?: boolean;
  payload: unknown;
}

export const FIXTURE_DELIVERIES: FixtureDelivery[] = [
  {
    id: 'dBad',
    objectiveId: 'oa',
    deliveredAt: T.t0,
    payload: { deliveryReport: { ...report({ risks: ['Malformed risk.'] }), schemaVersion: 2 } }
  },
  {
    id: 'dA1',
    objectiveId: 'oa',
    deliveredAt: T.t1,
    payload: {
      deliveryReport: report({
        agentActions: [
          {
            id: 'human-action-1',
            action: 'Set FOO in production.',
            category: 'environment',
            source: 'agent'
          }
        ],
        risks: ['Retry storms under load.', '  retry storms   UNDER load.'],
        suggestions: [SUGGESTIONS.sA1, SUGGESTIONS.sA2]
      })
    }
  },
  {
    id: 'dA2',
    objectiveId: 'oa',
    deliveredAt: T.t2,
    payload: {
      deliveryReport: report({
        agentActions: [
          {
            id: 'human-action-1',
            action: 'Run backfill please.',
            category: 'database',
            source: 'agent'
          }
        ],
        actions: [
          {
            id: 'human-action-1',
            action: 'Run the backfill.',
            category: 'database',
            blocking: true,
            source: 'agent'
          },
          ruleAction
        ],
        risks: ['Cache may serve stale rows.'],
        suggestions: [SUGGESTIONS.sA3],
        composed: true
      })
    }
  },
  {
    id: 'dB1',
    objectiveId: 'ob',
    deliveredAt: T.t2b,
    payload: {
      deliveryReport: report({
        agentActions: [
          {
            id: 'human-action-1',
            action: 'Rotate the key.',
            category: 'external_service',
            source: 'agent'
          }
        ],
        risks: ['Old risk.'],
        suggestions: [SUGGESTIONS.sB1, SUGGESTIONS.sB2]
      })
    }
  },
  {
    id: 'dB2',
    objectiveId: 'ob',
    deliveredAt: T.t4,
    payload: {
      deliveryReport: report({
        agentActions: [
          {
            id: 'human-action-1',
            action: 'Rotate the new key.',
            category: 'external_service',
            source: 'agent'
          }
        ],
        risks: ['New risk.']
      })
    }
  },
  {
    id: 'dC1',
    objectiveId: 'oc',
    deliveredAt: T.t1,
    payload: {
      deliveryReport: report({
        risks: ['Deleted-objective risk.'],
        suggestions: [SUGGESTIONS.sC1]
      })
    }
  },
  {
    id: 'dDel',
    objectiveId: 'oa',
    deliveredAt: T.t5,
    deleted: true,
    payload: { deliveryReport: report({ risks: ['Never shown.'] }) }
  }
];

export interface ExpectedMissionItem {
  deliveryId: string;
  kind: 'risk' | 'human_action' | 'suggestion';
  text: string;
  status: 'open' | 'done' | 'dismissed' | 'superseded';
  outcome?: string;
  outcomeRef?: string;
}

/** Every row the backfill must produce for the fixture, in no particular order. */
export const EXPECTED_MISSION_ITEMS: ExpectedMissionItem[] = [
  { deliveryId: 'dA1', kind: 'human_action', text: 'Set FOO in production.', status: 'superseded' },
  { deliveryId: 'dA1', kind: 'risk', text: 'Retry storms under load.', status: 'open' },
  {
    deliveryId: 'dA1',
    kind: 'suggestion',
    text: 'Add retry metrics',
    status: 'done',
    outcome: 'mission_created',
    outcomeRef: 'w-items:2'
  },
  { deliveryId: 'dA1', kind: 'suggestion', text: 'Document the flag', status: 'open' },
  { deliveryId: 'dA2', kind: 'human_action', text: 'Run the backfill.', status: 'open' },
  {
    deliveryId: 'dA2',
    kind: 'human_action',
    text: 'Apply the database migration(s) included in this delivery.',
    status: 'open'
  },
  { deliveryId: 'dA2', kind: 'risk', text: 'Cache may serve stale rows.', status: 'open' },
  { deliveryId: 'dA2', kind: 'suggestion', text: 'Split the worker', status: 'open' },
  { deliveryId: 'dB1', kind: 'human_action', text: 'Rotate the key.', status: 'superseded' },
  { deliveryId: 'dB1', kind: 'risk', text: 'Old risk.', status: 'superseded' },
  { deliveryId: 'dB1', kind: 'suggestion', text: 'Remove the old route', status: 'dismissed' },
  { deliveryId: 'dB1', kind: 'suggestion', text: 'Rename the table', status: 'superseded' },
  { deliveryId: 'dB2', kind: 'human_action', text: 'Rotate the new key.', status: 'open' },
  { deliveryId: 'dB2', kind: 'risk', text: 'New risk.', status: 'open' },
  { deliveryId: 'dC1', kind: 'risk', text: 'Deleted-objective risk.', status: 'open' },
  {
    deliveryId: 'dC1',
    kind: 'suggestion',
    text: 'Backfill the cache',
    status: 'done',
    outcome: 'objective_added',
    outcomeRef: 'w-items:1.cccc'
  }
];

/**
 * Seeds the fixture through `client`. Booleans and JSON are bound as values
 * both editions accept, so one seed serves SQLite and Postgres.
 */
export async function seedMissionItemsFixture(
  client: DatabaseClient,
  { legacyResolutions = true }: { legacyResolutions?: boolean } = {}
): Promise<void> {
  const { workspaceId, projectId, missionId, otherMissionId } = FIXTURE_IDS;
  const now = T.t0;
  const bool = (value: boolean) => (client.dialect === 'postgres' ? value : value ? 1 : 0);
  await client.run(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ['org-items', 'Org', now, now]
  );
  await client.run(
    `INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
     VALUES (?, 'org-items', ?, 'W', 'local', ?, ?)`,
    [workspaceId, workspaceId, now, now]
  );
  await client.run(
    `INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at)
     VALUES (?, ?, ?, 'P', 'active', ?, ?)`,
    [projectId, workspaceId, projectId, now, now]
  );
  await client.run(
    `INSERT INTO project_statuses (id, workspace_id, project_id, key, name, type, position,
       is_default, is_terminal, created_at, updated_at)
     VALUES ('s-items', ?, ?, 'draft', 'Draft', 'draft', 0, ?, ?, ?, ?)`,
    [workspaceId, projectId, bool(true), bool(false), now, now]
  );
  for (const [index, id] of [missionId, otherMissionId].entries()) {
    await client.run(
      `INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title,
         status_id, status_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'M', 's-items', 'draft', ?, ?)`,
      [id, workspaceId, projectId, `${workspaceId}:${index + 1}`, index + 1, now, now]
    );
  }
  const objectives: Array<[string, string, string, string | null, string | null]> = [
    ['oa', 'aaaa', 'complete', null, null],
    ['ob', 'bbbb', 'draft', T.t3, null],
    ['oc', 'cccc', 'complete', null, T.t3]
  ];
  for (const [index, [id, key, state, reopenedAt, deletedAt]] of objectives.entries()) {
    await client.run(
      `INSERT INTO objectives (id, workspace_id, project_id, mission_id, display_key, position,
         title, state, reopened_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Objective', ?, ?, ?, ?, ?)`,
      [id, workspaceId, projectId, missionId, key, index, state, reopenedAt, now, now, deletedAt]
    );
  }
  for (const delivery of FIXTURE_DELIVERIES) {
    await client.run(
      `INSERT INTO deliveries (id, workspace_id, project_id, mission_id, objective_id, summary,
         payload_json, delivered_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 'Delivered.', ?, ?, ?, ?, ?)`,
      [
        delivery.id,
        workspaceId,
        projectId,
        missionId,
        delivery.objectiveId,
        JSON.stringify(delivery.payload),
        delivery.deliveredAt,
        delivery.deliveredAt,
        delivery.deliveredAt,
        delivery.deleted ? delivery.deliveredAt : null
      ]
    );
  }
  if (!legacyResolutions) return;
  const resolutions: Array<[string, string, string, string, string | null, string | null]> = [
    ['dA1', SUGGESTIONS.sA1.id, 'oa', 'done', 'mission_created', `${workspaceId}:2`],
    ['dB1', SUGGESTIONS.sB1.id, 'ob', 'dismissed', null, null],
    ['dC1', SUGGESTIONS.sC1.id, 'oc', 'done', 'objective_added', `${workspaceId}:1.cccc`],
    ['dA2', 'deferred-work-9-orphanorphanorph', 'oa', 'dismissed', null, null]
  ];
  for (const [deliveryId, actionId, objectiveId, status, outcome, outcomeRef] of resolutions) {
    await client.run(
      `INSERT INTO human_action_resolutions (delivery_id, action_id, workspace_id, mission_id,
         objective_id, status, outcome, outcome_ref, resolved_by_workspace_user_id, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [deliveryId, actionId, workspaceId, missionId, objectiveId, status, outcome, outcomeRef, T.t4]
    );
  }
}

/** Row fields compared by the migration tests. */
export const SELECT_FIXTURE_ITEMS_SQL = `SELECT id, delivery_id, objective_id, kind, item_ref,
       position, text, status, status_reason, resolved_by_kind, resolved_by_workspace_user_id,
       outcome, outcome_ref, resolved_at, reported_at, revision
  FROM mission_items
 ORDER BY delivery_id, kind, position`;

export function summariseItems(
  rows: Array<Record<string, unknown>>
): Array<
  Omit<ExpectedMissionItem, 'outcome' | 'outcomeRef'> & { outcome?: string; outcomeRef?: string }
> {
  return rows
    .map(row => ({
      deliveryId: String(row.delivery_id),
      kind: row.kind as ExpectedMissionItem['kind'],
      text: String(row.text),
      status: row.status as ExpectedMissionItem['status'],
      ...(row.outcome ? { outcome: String(row.outcome) } : {}),
      ...(row.outcome_ref ? { outcomeRef: String(row.outcome_ref) } : {})
    }))
    .sort(compareExpected);
}

export function compareExpected(left: ExpectedMissionItem, right: ExpectedMissionItem): number {
  return (
    left.deliveryId.localeCompare(right.deliveryId) ||
    left.kind.localeCompare(right.kind) ||
    left.text.localeCompare(right.text)
  );
}
