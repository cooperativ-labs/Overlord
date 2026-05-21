import type { FeedPost } from '@/lib/actions/feed';

const PROJECT_ID = '2fce9af3-dc9e-4929-82da-d8c52e3fcaf6';
const PROJECT_NAME = 'Overlord';
const PROJECT_COLOR = '#2dd4bf';

function makePost(overrides: Partial<FeedPost>): FeedPost {
  return {
    id: 'demo-post',
    organization_id: 1,
    project_id: PROJECT_ID,
    ticket_id: 'demo-ticket',
    objective_id: null,
    source_objective_id: null,
    title: '',
    summary: '',
    body: '',
    tags: [],
    impact_level: 'notable',
    files_touched: [],
    tradeoffs: [],
    human_actions: [],
    tickets_created: [],
    objective_sections: [],
    orphan_file_changes: [],
    total_events: 0,
    total_files: 0,
    pending_actions: 0,
    source_event_ids: [],
    source_window_start: null,
    source_window_end: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    project_name: PROJECT_NAME,
    project_color: PROJECT_COLOR,
    ticket_identifier: null,
    ticket_title: null,
    ticket_objective: null,
    ticket_sequence: null,
    ...overrides
  };
}

export const DEMO_FEED_POSTS: FeedPost[] = [
  makePost({
    id: 'demo-post-1114',
    ticket_id: 'demo-ticket-1114',
    ticket_identifier: '1:1114',
    ticket_sequence: 1242,
    ticket_title: 'Manage project checkpoints',
    ticket_objective:
      'Add a UI to Project Settings that lets users list and prune stale git checkpoints.',
    title: 'Project checkpoints can now be pruned from settings',
    summary:
      'New Checkpoints page in Project Settings with a scrollable table, row-level delete, and a one-click prune-stale flow. The backing server action commits a transaction so partial-state races are impossible.',
    body: '',
    impact_level: 'significant',
    tags: ['ui', 'settings', 'git'],
    total_events: 27,
    total_files: 7,
    pending_actions: 1,
    created_at: '2026-05-18T07:57:40.000Z',
    updated_at: '2026-05-18T07:57:46.000Z',
    human_actions: ['Confirm the Checkpoints page appears in your Project Settings sidebar.'],
    tickets_created: [
      {
        id: 'demo-followup-1117',
        reference: '1:1117',
        sequence: 1245,
        title: 'Add checkpoint retention policy config'
      }
    ],
    objective_sections: [
      {
        id: 'obj-1114-a',
        objective_id: 'obj-1114-a',
        index: 1,
        title: 'Database migration & server action',
        state: 'delivered',
        position: 1,
        duration: '4m 12s',
        events: 9,
        takeaway:
          'Migration adds checkpoints table; action exposes list, delete, and bulk-prune operations.',
        body: 'Created `supabase/migrations/20260518_checkpoints.sql` with the `project_checkpoints` table (RLS-gated to org members). Wrote `lib/actions/checkpoints.ts` with three exported server actions: `listCheckpointsAction`, `deleteCheckpointAction`, and `pruneStaleCheckpointsAction`. The prune action runs inside a single transaction and returns a count of removed rows.',
        file_changes: [
          {
            path: 'supabase/migrations/20260518_checkpoints.sql',
            status: 'added',
            additions: 42,
            deletions: 0,
            note: 'New table with RLS policies for org members'
          },
          {
            path: 'lib/actions/checkpoints.ts',
            status: 'added',
            additions: 118,
            deletions: 0,
            note: 'list, delete, and bulk-prune server actions'
          },
          { path: 'types/database.types.ts', status: 'modified', additions: 31, deletions: 2 }
        ],
        action_required: [],
        tradeoffs: [
          {
            decision: 'Single-transaction prune in a server action',
            alternatives_considered: 'Client-side loop over individual deletes',
            rationale:
              'One transaction prevents partial-state UI on flaky connections and is faster on large checkpoint sets.'
          }
        ],
        event_ids: [],
        updated_at: '2026-05-18T07:42:10.000Z',
        agent_identifier: 'claude-code',
        model_identifier: 'claude-sonnet-4-6'
      },
      {
        id: 'obj-1114-b',
        objective_id: 'obj-1114-b',
        index: 2,
        title: 'CheckpointsPage UI component',
        state: 'delivered',
        position: 2,
        duration: '6m 38s',
        events: 11,
        takeaway:
          'Scrollable table with commit ID, datetime, linked objective, and row-level delete. Prune button with confirmation popover.',
        body: 'Built `apps/web/components/modals/project-settings/CheckpointsPage.tsx`. The table virtualises rows beyond 50 to keep the DOM lean. Each row has an inline Delete button using `LoadingButton` to prevent double-submits. A **Prune all stale** button opens a popover that explains what "stale" means (no longer reachable from any active objective), then calls `pruneStaleCheckpointsAction` on confirm.',
        file_changes: [
          {
            path: 'apps/web/components/modals/project-settings/CheckpointsPage.tsx',
            status: 'added',
            additions: 204,
            deletions: 0,
            note: 'Main page component'
          },
          {
            path: 'apps/web/components/modals/ProjectSettingsModal.tsx',
            status: 'modified',
            additions: 18,
            deletions: 3,
            note: 'Added Checkpoints nav item and lazy-loaded tab'
          }
        ],
        action_required: ['Confirm the Checkpoints page appears in your Project Settings sidebar.'],
        tradeoffs: [],
        event_ids: [],
        updated_at: '2026-05-18T07:49:52.000Z',
        agent_identifier: 'claude-code',
        model_identifier: 'claude-sonnet-4-6'
      },
      {
        id: 'obj-1114-c',
        objective_id: 'obj-1114-c',
        index: 3,
        title: 'Wire up revert flow in ticket detail',
        state: 'delivered',
        position: 3,
        duration: '3m 55s',
        events: 7,
        takeaway:
          'Ticket detail now shows a Revert button next to each objective that has a checkpoint ref.',
        body: 'Added a **Revert to checkpoint** action on `TicketObjectivesSection`. The button calls `ovld protocol revert` via a server action and toasts success/failure. A safety ref is written under `refs/overlord/safety/` before the hard reset so the previous state is always recoverable.',
        file_changes: [
          {
            path: 'apps/web/components/features/TicketObjectivesSection.tsx',
            status: 'modified',
            additions: 47,
            deletions: 6,
            note: 'Revert button + confirmation dialog'
          },
          {
            path: 'lib/actions/tickets.ts',
            status: 'modified',
            additions: 29,
            deletions: 0,
            note: 'revertToCheckpointAction server action'
          }
        ],
        action_required: [],
        tradeoffs: [
          {
            decision: 'Write safety ref before hard reset',
            alternatives_considered: 'Rely on reflog alone',
            rationale:
              'Named safety refs survive aggressive `git gc` runs; reflog entries can be pruned.'
          }
        ],
        event_ids: [],
        updated_at: '2026-05-18T07:55:18.000Z',
        agent_identifier: 'claude-code',
        model_identifier: 'claude-sonnet-4-6'
      }
    ],
    orphan_file_changes: [
      { path: 'apps/web/app/sitemap.ts', status: 'modified', additions: 3, deletions: 1 }
    ]
  }),

  makePost({
    id: 'demo-post-1098',
    ticket_id: 'demo-ticket-1098',
    ticket_identifier: '1:1098',
    ticket_sequence: 1226,
    ticket_title: 'Slack notifications for ticket activity',
    ticket_objective:
      'Deliver Slack notifications to the configured workspace webhook when a ticket is delivered, asks a blocking question, or raises an alert.',
    title: 'Slack webhook delivers ticket events to your workspace',
    summary:
      'Edge function publishes deliver/question/alert events to a per-org Slack webhook. A pg_cron job retries failed sends with exponential backoff. Notification preferences UI is drafted but not yet shipped.',
    body: '',
    impact_level: 'significant',
    tags: ['integration', 'slack', 'edge-function'],
    total_events: 34,
    total_files: 9,
    pending_actions: 2,
    created_at: '2026-05-15T16:12:00.000Z',
    updated_at: '2026-05-15T16:12:18.000Z',
    human_actions: [
      'Paste your Slack incoming webhook URL into Settings → Integrations → Slack.',
      'Confirm a test message appears in the chosen channel.'
    ],
    tickets_created: [],
    objective_sections: [
      {
        id: 'obj-1098-a',
        objective_id: 'obj-1098-a',
        index: 1,
        title: 'Database schema & notification_events table',
        state: 'delivered',
        position: 1,
        duration: '3m 20s',
        events: 6,
        takeaway:
          'New notification_events table stores pending, sent, and failed webhook sends with retry metadata.',
        body: 'Migration adds `notification_events` (org_id, event_type, payload JSONB, status, attempts, last_error, next_retry_at). RLS restricts reads to org admins. A partial index on `(status, next_retry_at)` keeps the pg_cron query fast even at high volume.',
        file_changes: [
          {
            path: 'supabase/migrations/20260515_notification_events.sql',
            status: 'added',
            additions: 58,
            deletions: 0,
            note: 'Table, indexes, RLS, and pg_cron job registration'
          },
          { path: 'types/database.types.ts', status: 'modified', additions: 44, deletions: 3 }
        ],
        action_required: [],
        tradeoffs: [
          {
            decision: 'pg_cron for retries instead of a separate queue worker',
            alternatives_considered: 'BullMQ worker on the Next.js server',
            rationale:
              'pg_cron runs inside the database and survives Next.js restarts; no extra infra needed for Supabase-hosted projects.'
          }
        ],
        event_ids: [],
        updated_at: '2026-05-15T14:38:00.000Z',
        agent_identifier: 'claude-code',
        model_identifier: 'claude-sonnet-4-6'
      },
      {
        id: 'obj-1098-b',
        objective_id: 'obj-1098-b',
        index: 2,
        title: 'slack-notify Edge Function',
        state: 'delivered',
        position: 2,
        duration: '8m 47s',
        events: 16,
        takeaway:
          'Deno edge function formats and POSTs block-kit Slack messages; inserts retry rows on network failure.',
        body: "The function listens for `notification_events` inserts via a database trigger. It formats compact Block Kit messages for three event types: `deliver` (green header, files count, summary), `ask` (yellow, blocking question text), and `alert` (red, alert body). On non-2xx response it writes `status=failed` and sets `next_retry_at = now() + interval '2 ^ attempts minutes'`.",
        file_changes: [
          {
            path: 'supabase/functions/slack-notify/index.ts',
            status: 'added',
            additions: 187,
            deletions: 0,
            note: 'Main edge function with Block Kit formatting'
          },
          {
            path: 'supabase/functions/slack-notify/deno.json',
            status: 'added',
            additions: 9,
            deletions: 0
          }
        ],
        action_required: [
          'Paste your Slack incoming webhook URL into Settings → Integrations → Slack.'
        ],
        tradeoffs: [
          {
            decision: 'Database trigger → edge function instead of inline server action',
            alternatives_considered: 'POST from a Next.js server action after each protocol event',
            rationale:
              'Keeps webhook latency off the critical path and enables reliable retry without client-side coordination.'
          }
        ],
        event_ids: [],
        updated_at: '2026-05-15T15:26:40.000Z',
        agent_identifier: 'claude-code',
        model_identifier: 'claude-sonnet-4-6'
      },
      {
        id: 'obj-1098-c',
        objective_id: 'obj-1098-c',
        index: 3,
        title: 'Settings UI — Integrations page skeleton',
        state: 'delivered',
        position: 3,
        duration: '5m 02s',
        events: 12,
        takeaway:
          'Integrations tab added to Project Settings with a Slack webhook URL field; full preferences UI deferred.',
        body: 'Added an **Integrations** tab to Project Settings. For now it renders a single "Slack webhook URL" field that calls `upsertIntegrationAction`. A placeholder card for future integrations (GitHub, Linear, Jira) is shown greyed-out to set expectations.',
        file_changes: [
          {
            path: 'apps/web/components/modals/project-settings/IntegrationsPage.tsx',
            status: 'added',
            additions: 96,
            deletions: 0,
            note: 'Slack webhook URL field + placeholder cards'
          },
          {
            path: 'apps/web/components/modals/ProjectSettingsModal.tsx',
            status: 'modified',
            additions: 14,
            deletions: 2,
            note: 'Added Integrations tab'
          },
          {
            path: 'lib/actions/integrations.ts',
            status: 'added',
            additions: 54,
            deletions: 0,
            note: 'upsertIntegrationAction server action'
          }
        ],
        action_required: ['Confirm a test Slack message appears after saving the webhook URL.'],
        tradeoffs: [],
        event_ids: [],
        updated_at: '2026-05-15T16:08:22.000Z',
        agent_identifier: 'claude-code',
        model_identifier: 'claude-sonnet-4-6'
      }
    ],
    orphan_file_changes: []
  }),

  makePost({
    id: 'demo-post-1107',
    ticket_id: 'demo-ticket-1107',
    ticket_identifier: '1:1107',
    ticket_sequence: 1235,
    ticket_title: 'Add CSV export to ticket reports',
    ticket_objective:
      'Let users download a CSV of all tickets matching the current report filters without buffering the full dataset in memory.',
    title: 'Ticket reports can now be exported to CSV',
    summary:
      'One-button CSV export on the reports page. The export streams row-by-row from a server action so even boards with thousands of tickets complete without memory pressure.',
    body: '',
    impact_level: 'notable',
    tags: ['reports', 'export'],
    total_events: 14,
    total_files: 4,
    pending_actions: 0,
    created_at: '2026-05-14T11:02:00.000Z',
    updated_at: '2026-05-14T11:02:09.000Z',
    human_actions: [],
    tickets_created: [],
    objective_sections: [
      {
        id: 'obj-1107-a',
        objective_id: 'obj-1107-a',
        index: 1,
        title: 'Streaming server action for CSV generation',
        state: 'delivered',
        position: 1,
        duration: '5m 14s',
        events: 8,
        takeaway:
          'Server action yields CSV rows via a ReadableStream; tested up to 10 k rows without memory spike.',
        body: 'Added `exportReportCsvAction` in `lib/actions/reports-export.ts`. It opens a cursor on the `tickets` view filtered by the same params as `getReportRowsAction`, then yields header + data rows as UTF-8 CSV chunks. The browser receives a `text/csv` response and prompts a download without a round-trip to the client for buffering.',
        file_changes: [
          {
            path: 'lib/actions/reports-export.ts',
            status: 'added',
            additions: 89,
            deletions: 0,
            note: 'Streaming CSV export server action'
          }
        ],
        action_required: [],
        tradeoffs: [
          {
            decision: 'ReadableStream from a server action instead of a route handler',
            alternatives_considered: 'GET /api/reports/export?params=... route handler',
            rationale:
              'Server actions keep auth and RLS context automatically; no need to re-validate tokens in a route handler.'
          }
        ],
        event_ids: [],
        updated_at: '2026-05-14T10:44:18.000Z',
        agent_identifier: 'claude-code',
        model_identifier: 'claude-sonnet-4-6'
      },
      {
        id: 'obj-1107-b',
        objective_id: 'obj-1107-b',
        index: 2,
        title: 'Download CSV button on reports page',
        state: 'delivered',
        position: 2,
        duration: '2m 48s',
        events: 6,
        takeaway:
          'Download button wired to the streaming action; disabled during export with a spinner.',
        body: 'Added a **Download CSV** `LoadingButton` to the reports page toolbar. While the stream is in-flight the button shows a spinner and is disabled to prevent double-submits. Filename is `report-YYYY-MM-DD.csv` derived from the client clock.',
        file_changes: [
          {
            path: 'apps/web/app/(app)/reports/page.tsx',
            status: 'modified',
            additions: 34,
            deletions: 4,
            note: 'Download button + loading state'
          },
          {
            path: 'apps/web/components/features/ReportToolbar.tsx',
            status: 'modified',
            additions: 22,
            deletions: 1
          }
        ],
        action_required: [],
        tradeoffs: [],
        event_ids: [],
        updated_at: '2026-05-14T10:58:41.000Z',
        agent_identifier: 'claude-code',
        model_identifier: 'claude-sonnet-4-6'
      }
    ],
    orphan_file_changes: []
  })
];
