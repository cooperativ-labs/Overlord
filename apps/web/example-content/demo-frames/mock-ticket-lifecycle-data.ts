import type { Database } from '@/types/database.types';

import { DEMO_OBJECTIVES, DEMO_TICKET_DETAILS } from './mock-ticket-details';

export { DEMO_OBJECTIVES, DEMO_TICKET_DETAILS };

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type FileChange = Database['public']['Tables']['file_changes']['Row'];

const TICKET_UUID = '22222222-3333-4444-5555-666666666666';
const OBJECTIVE_1_UUID = 'bbbbbbbb-1111-2222-3333-444444444441';
const OBJECTIVE_2_UUID = 'bbbbbbbb-1111-2222-3333-444444444442';
const SESSION_1_UUID = '77777777-8888-9999-aaaa-000000000001';
const SESSION_2_UUID = '77777777-8888-9999-aaaa-000000000002';
const USER_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

export const DEMO_TICKET_LIFECYCLE_INFO = {
  ticket_id: TICKET_UUID,
  ticket_identifier: DEMO_TICKET_DETAILS.ticket_identifier,
  title: DEMO_TICKET_DETAILS.title,
  project_name: DEMO_TICKET_DETAILS.project_name,
  project_color: DEMO_TICKET_DETAILS.project_color,
  agent: 'Claude Code',
  model: 'claude-sonnet-4-6'
};

/** Newest first — matches LiveActivityFeed display order. */
export const DEMO_TICKET_LIFECYCLE_EVENTS: TicketEvent[] = [
  {
    id: 'lifecycle-evt-2-deliver',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_2_UUID,
    event_type: 'deliver',
    phase: 'deliver',
    summary: [
      'Shipped the **Slack webhook edge function** for notification delivery.',
      '',
      'The function drains `notification_delivery_queue`, formats Block Kit payloads for',
      'status_change, deliver, mention, and question events, and posts to the org webhook URL.',
      'Transient 5xx responses retry with exponential backoff (3 attempts, capped at 30s).',
      'Delivery failures are recorded on the queue row without blocking ticket writes.'
    ].join('\n'),
    payload: {},
    is_blocking: false,
    created_at: '2026-05-17T22:42:00.000Z',
    created_by: null
  },
  {
    id: 'lifecycle-evt-2-update',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_2_UUID,
    event_type: 'update',
    phase: 'execute',
    summary:
      'Implemented `supabase/functions/slack-notify/index.ts` with queue polling, Block Kit formatting, and retry wrapper. Wired the function to read org webhook URLs from `organization_integrations` and mark rows `delivered` or `failed` after each attempt.',
    payload: {},
    is_blocking: false,
    created_at: '2026-05-17T22:20:00.000Z',
    created_by: null
  },
  {
    id: 'lifecycle-evt-2-attach',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_2_UUID,
    event_type: 'update',
    phase: 'execute',
    summary:
      'Claude Code attached via local runner for objective **Slack webhook edge function**. Loaded schema from the prior delivery, org integration settings, and acceptance criteria.',
    payload: {},
    is_blocking: false,
    created_at: '2026-05-17T21:55:00.000Z',
    created_by: null
  },
  {
    id: 'lifecycle-evt-followup',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_1_UUID,
    event_type: 'user_follow_up',
    phase: null,
    summary:
      'User message (verbatim): Schema looks good — please implement the Slack edge function next. Use Block Kit for the message body and make sure 5xx retries never block the ticket write path.',
    payload: { hook_type: 'UserPromptSubmit', entry_type: 'follow_up' },
    is_blocking: false,
    created_at: '2026-05-15T10:30:00.000Z',
    created_by: USER_UUID
  },
  {
    id: 'lifecycle-evt-1-deliver',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_1_UUID,
    event_type: 'deliver',
    phase: 'deliver',
    summary: [
      'Delivered the **notification event schema and migration**.',
      '',
      'Added `notification_events` to record status_change, deliver, mention, and question',
      'activity, plus `notification_delivery_queue` as a lightweight worker table with retry',
      'metadata. Regenerated TypeScript types and added RLS policies scoped by organization.'
    ].join('\n'),
    payload: {},
    is_blocking: false,
    created_at: '2026-05-14T17:01:00.000Z',
    created_by: null
  },
  {
    id: 'lifecycle-evt-1-update',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_1_UUID,
    event_type: 'update',
    phase: 'execute',
    summary:
      'Drafted migration for `notification_events` and `notification_delivery_queue` with enums for event category and delivery status. Added indexes on `(organization_id, created_at)` and a partial index for pending queue rows. Running `yarn generate` to refresh types.',
    payload: {},
    is_blocking: false,
    created_at: '2026-05-14T16:52:00.000Z',
    created_by: null
  },
  {
    id: 'lifecycle-evt-1-attach',
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_1_UUID,
    event_type: 'update',
    phase: 'execute',
    summary:
      'Claude Code attached via local runner for objective **Notification event schema + migration**. Reviewed existing ticket event types and acceptance criteria for per-user opt-out and non-blocking Slack failures.',
    payload: {},
    is_blocking: false,
    created_at: '2026-05-14T16:45:00.000Z',
    created_by: null
  }
];

export const DEMO_TICKET_LIFECYCLE_FILE_CHANGES: FileChange[] = [
  {
    id: 'lifecycle-fc-1-migration',
    ticket_id: TICKET_UUID,
    event_id: 'lifecycle-evt-1-deliver',
    session_id: SESSION_1_UUID,
    objective_id: OBJECTIVE_1_UUID,
    checkpoint_id: null,
    file_path: 'supabase/migrations/20260514160000_notification_events.sql',
    file_name: '20260514160000_notification_events.sql',
    label: 'Notification events schema',
    summary:
      'Creates `notification_events` and `notification_delivery_queue` with enums, foreign keys, and organization-scoped RLS.',
    why: 'Ticket activity needs a durable event log and an async delivery queue before Slack integration can consume it.',
    impact:
      'All notification categories (status_change, deliver, mention, question) can be recorded and queued without blocking writes.',
    hunks: [{ header: '@@ -0,0 +1,148 @@' }],
    change_kind: 'add',
    attribution_source: 'agent',
    confidence: 'high',
    created_at: '2026-05-14T17:01:00.100Z',
    updated_at: '2026-05-14T17:01:00.100Z'
  },
  {
    id: 'lifecycle-fc-1-types',
    ticket_id: TICKET_UUID,
    event_id: 'lifecycle-evt-1-deliver',
    session_id: SESSION_1_UUID,
    objective_id: OBJECTIVE_1_UUID,
    checkpoint_id: null,
    file_path: 'types/database.types.ts',
    file_name: 'database.types.ts',
    label: 'Regenerate Supabase types',
    summary: 'Adds Row/Insert/Update types for the new notification tables and enums.',
    why: 'Server actions and edge functions need typed access to the new schema.',
    impact: 'TypeScript consumers can reference notification tables without manual casts.',
    hunks: [{ header: '@@ -1890,6 +1890,72 @@' }],
    change_kind: 'modify',
    attribution_source: 'agent',
    confidence: 'high',
    created_at: '2026-05-14T17:01:00.110Z',
    updated_at: '2026-05-14T17:01:00.110Z'
  },
  {
    id: 'lifecycle-fc-2-function',
    ticket_id: TICKET_UUID,
    event_id: 'lifecycle-evt-2-deliver',
    session_id: SESSION_2_UUID,
    objective_id: OBJECTIVE_2_UUID,
    checkpoint_id: null,
    file_path: 'supabase/functions/slack-notify/index.ts',
    file_name: 'index.ts',
    label: 'Slack notify edge function',
    summary:
      'Polls pending queue rows, formats Block Kit payloads, posts to the org webhook, and retries on 5xx with exponential backoff.',
    why: 'Objective requires a Supabase Edge Function that consumes the queue without blocking ticket writes.',
    impact:
      'Organizations with a configured Slack webhook receive ticket activity messages; failures stay on the queue row for inspection.',
    hunks: [{ header: '@@ -0,0 +1,214 @@' }],
    change_kind: 'add',
    attribution_source: 'agent',
    confidence: 'high',
    created_at: '2026-05-17T22:42:00.100Z',
    updated_at: '2026-05-17T22:42:00.100Z'
  },
  {
    id: 'lifecycle-fc-2-block-kit',
    ticket_id: TICKET_UUID,
    event_id: 'lifecycle-evt-2-deliver',
    session_id: SESSION_2_UUID,
    objective_id: OBJECTIVE_2_UUID,
    checkpoint_id: null,
    file_path: 'supabase/functions/slack-notify/format-block-kit.ts',
    file_name: 'format-block-kit.ts',
    label: 'Block Kit payload formatter',
    summary:
      'Maps notification event categories to Slack Block Kit sections with ticket link, summary excerpt, and agent attribution.',
    why: 'Keeps formatting logic separate from HTTP/retry plumbing for easier testing and iteration.',
    impact: 'Each notification category renders a consistent Slack message layout.',
    hunks: [{ header: '@@ -0,0 +1,96 @@' }],
    change_kind: 'add',
    attribution_source: 'agent',
    confidence: 'high',
    created_at: '2026-05-17T22:42:00.110Z',
    updated_at: '2026-05-17T22:42:00.110Z'
  },
  {
    id: 'lifecycle-fc-2-retry',
    ticket_id: TICKET_UUID,
    event_id: 'lifecycle-evt-2-deliver',
    session_id: SESSION_2_UUID,
    objective_id: OBJECTIVE_2_UUID,
    checkpoint_id: null,
    file_path: 'supabase/functions/slack-notify/retry.ts',
    file_name: 'retry.ts',
    label: 'Exponential backoff helper',
    summary:
      'Wraps fetch with up to 3 retries on 5xx responses, doubling delay from 2s to a 30s cap.',
    why: 'Acceptance criteria require resilient delivery without blocking the originating ticket write.',
    impact:
      'Transient Slack outages are absorbed; permanent failures surface on the queue row only.',
    hunks: [{ header: '@@ -0,0 +1,48 @@' }],
    change_kind: 'add',
    attribution_source: 'agent',
    confidence: 'high',
    created_at: '2026-05-17T22:42:00.120Z',
    updated_at: '2026-05-17T22:42:00.120Z'
  }
];
