import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type FileChange = Database['public']['Tables']['file_changes']['Row'];

const TICKET_UUID = '11111111-2222-3333-4444-555555555555';
const SESSION_UUID = '66666666-7777-8888-9999-000000000000';
const OBJECTIVE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

export const DEMO_TICKET_INFO = {
  ticket_identifier: '1:1114',
  title: 'Manage project checkpoints',
  project_name: 'Overlord',
  project_color: '#2dd4bf',
  agent: 'Claude Code',
  model: 'claude-sonnet-4-6'
};

export const DEMO_TICKET_EVENTS: TicketEvent[] = [
  {
    id: 'evt-deliver',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_UUID,
    event_type: 'deliver',
    phase: 'deliver',
    summary: [
      'Shipped the **Checkpoints** subpage in Project Settings.',
      '',
      'It lists every local git checkpoint Overlord created for the project with commit id,',
      'timestamp, and the objective that triggered it. The list scrolls past 8 rows, each row',
      'has a delete affordance, and a `Prune all stale checkpoints` action collapses everything',
      'whose objective is complete and whose ref is no longer reachable.',
      '',
      'Added a popover next to the prune button per follow-up — it explains what counts as stale',
      'in one sentence with an example.'
    ].join('\n'),
    payload: {},
    is_blocking: false,
    created_at: '2026-05-18T07:57:46.000Z',
    created_by: null
  },
  {
    id: 'evt-followup',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_UUID,
    event_type: 'user_follow_up',
    phase: null,
    summary:
      'User message (verbatim): Please add a small popover next to the Prune button that explains what "stale" means — I want reviewers to understand it without reading code.',
    payload: { hook_type: 'UserPromptSubmit', entry_type: 'follow_up' },
    is_blocking: false,
    created_at: '2026-05-18T07:49:02.000Z',
    created_by: USER_UUID
  },
  {
    id: 'evt-update',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_UUID,
    event_type: 'update',
    phase: 'execute',
    summary:
      'Scanned `lib/actions/checkpoints.ts` and the existing project settings modal. Plan: add a new **Checkpoints** subpage with a scrollable table, a per-row delete, and a *Prune all stale* button. Stale = checkpoints whose objective is `complete` and whose ref no longer points to a reachable commit.',
    payload: {},
    is_blocking: false,
    created_at: '2026-05-18T07:46:12.000Z',
    created_by: null
  },
  {
    id: 'evt-checkpoint',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_UUID,
    event_type: 'update',
    phase: 'execute',
    summary: 'Created local git checkpoint for objective `manage-checkpoints`.',
    payload: {
      checkpoint_ref: 'refs/overlord/checkpoints/manage-checkpoints',
      head_sha: 'a1b2c3d'
    },
    is_blocking: false,
    created_at: '2026-05-18T07:44:05.000Z',
    created_by: null
  }
];

export const DEMO_FILE_CHANGES: FileChange[] = [
  {
    id: 'fc-1',
    ticket_id: TICKET_UUID,
    event_id: 'evt-deliver',
    session_id: SESSION_UUID,
    objective_id: OBJECTIVE_UUID,
    checkpoint_id: null,
    file_path: 'apps/web/components/modals/project-settings/CheckpointsPage.tsx',
    file_name: 'CheckpointsPage.tsx',
    label: 'New Checkpoints subpage',
    summary:
      'Adds a virtualised, scrollable table of checkpoints with per-row delete and a `Prune all stale` action.',
    why: 'Users had no way to clean up checkpoint refs accumulated by long-running objectives.',
    impact:
      'Project Settings → Checkpoints now lists every checkpoint and lets users delete one or prune the stale tail in one click.',
    hunks: [{ header: '@@ -0,0 +1,182 @@' }],
    change_kind: 'add',
    attribution_source: 'agent',
    confidence: 'high',
    created_at: '2026-05-18T07:57:46.100Z',
    updated_at: '2026-05-18T07:57:46.100Z'
  },
  {
    id: 'fc-2',
    ticket_id: TICKET_UUID,
    event_id: 'evt-deliver',
    session_id: SESSION_UUID,
    objective_id: OBJECTIVE_UUID,
    checkpoint_id: null,
    file_path: 'lib/actions/checkpoints.ts',
    file_name: 'checkpoints.ts',
    label: 'Server actions for list/delete/prune',
    summary:
      'Adds `listProjectCheckpointsAction`, `deleteCheckpointAction`, and `pruneStaleCheckpointsAction` with RLS-aware project scoping.',
    why: 'The new UI needs three thin server actions; pruning runs in a single transaction to keep the row count consistent.',
    impact:
      'All three actions are organization-scoped and return shape that the table can render without extra round-trips.',
    hunks: [{ header: '@@ -1,0 +1,96 @@' }],
    change_kind: 'add',
    attribution_source: 'agent',
    confidence: 'high',
    created_at: '2026-05-18T07:57:46.110Z',
    updated_at: '2026-05-18T07:57:46.110Z'
  },
  {
    id: 'fc-3',
    ticket_id: TICKET_UUID,
    event_id: 'evt-deliver',
    session_id: SESSION_UUID,
    objective_id: OBJECTIVE_UUID,
    checkpoint_id: null,
    file_path: 'apps/web/components/modals/ProjectSettingsModal.tsx',
    file_name: 'ProjectSettingsModal.tsx',
    label: 'Wire Checkpoints tab into the modal',
    summary: 'Adds a `Checkpoints` entry to the settings sidebar and routes to the new page.',
    why: 'New page would be unreachable without this wiring; matches existing tab pattern.',
    impact: 'No behavioral change for users who do not open Project Settings.',
    hunks: [{ header: '@@ -42,6 +42,12 @@' }],
    change_kind: 'modify',
    attribution_source: 'agent',
    confidence: 'high',
    created_at: '2026-05-18T07:57:46.120Z',
    updated_at: '2026-05-18T07:57:46.120Z'
  }
];
