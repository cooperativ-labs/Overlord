export type DemoObjectiveState = 'complete' | 'draft' | 'future';

export type DemoObjective = {
  id: string;
  title: string;
  body: string;
  state: DemoObjectiveState;
  agent?: 'claude' | 'codex';
  model?: string;
  completedAt?: string;
  autoAdvance?: boolean;
};

export const DEMO_TICKET_DETAILS = {
  ticket_identifier: '1:1098',
  title: 'Slack notifications for ticket activity',
  project_name: 'Overlord',
  project_color: '#2dd4bf',
  status: 'execute',
  execution_target: 'agent' as const,
  due_label: 'Due in 3 days',
  schedule_label: 'No schedule',
  tags: [
    { id: 't-1', label: 'notifications', color: '#a78bfa' },
    { id: 't-2', label: 'slack', color: '#38bdf8' }
  ],
  acceptance_criteria:
    'Notifications fire for status_change, deliver, mention, and question events; per-user opt-out works; Slack failures never block ticket writes.',
  available_tools:
    'Supabase migrations, Edge Functions, pg_cron, Slack incoming webhooks, Block Kit formatter.'
};

export const DEMO_OBJECTIVES: DemoObjective[] = [
  {
    id: 'obj-1',
    title: 'Notification event schema + migration',
    body: 'Design the notification event schema and database model. Add a `notification_events` table that records what happened (status_change, deliver, mention, question) and a lightweight worker queue table to drive delivery. Write the migration plus regenerate TypeScript types.',
    state: 'complete',
    agent: 'claude',
    model: 'claude-sonnet-4-6',
    completedAt: '2026-05-14 17:01',
    autoAdvance: true
  },
  {
    id: 'obj-2',
    title: 'Slack webhook edge function',
    body: "Implement the Slack webhook integration as a Supabase Edge Function. Consume the notification queue, format Slack Block Kit payloads, post to the org's configured incoming webhook URL, and retry with exponential backoff on 5xx.",
    state: 'complete',
    agent: 'claude',
    model: 'claude-opus-4-7',
    completedAt: '2026-05-17 22:42',
    autoAdvance: true
  },
  {
    id: 'obj-3',
    title: 'User notification preferences UI',
    body: 'Build the user notification preferences UI in Settings → Notifications. Let users opt in/out of categories (mentions, deliveries, blocking questions) and choose a delivery channel (Slack DM via the org bot, or shared channel). Persist preferences in `user_notification_preferences`.',
    state: 'draft',
    agent: 'claude',
    model: 'claude-opus-4-7',
    autoAdvance: true
  },
  {
    id: 'obj-4',
    title: 'Quiet hours + filtering',
    body: 'Add notification filtering and quiet hours. Users should be able to mute notifications by project, by ticket priority, and during a daily quiet-hours window in their local timezone.',
    state: 'future',
    autoAdvance: true
  },
  {
    id: 'obj-5',
    title: 'End-to-end notification tests',
    body: 'End-to-end tests for the notification flow: simulate a ticket lifecycle (attach → ask → deliver → status_change) and assert the correct sequence of Slack messages is posted, that retries fire on 5xx, and that user preferences correctly suppress unsubscribed categories.',
    state: 'future',
    autoAdvance: true
  }
];
