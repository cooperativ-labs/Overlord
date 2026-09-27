/**
 * Human-friendly presentation of agent-harness markup that leaks into mission summaries.
 *
 * Claude Code injects XML-ish blocks into the conversation as if the user had typed them: a
 * `<task-notification>` when a background command finishes, `<command-name>` tags when a slash
 * command runs, `<system-reminder>` context, and so on. Hooks and agents relay that text verbatim,
 * so it reaches the activity feed as a raw tag soup — and, worse, as a "user follow-up" the user
 * never wrote. These rules turn it back into something a person can read, and say when the text
 * was never the user speaking at all.
 *
 * Presentation only: the stored summary is untouched, so nothing here can lose information.
 */

export interface TaskNotification {
  taskId: string | null;
  toolUseId: string | null;
  outputFile: string | null;
  status: string | null;
  summary: string | null;
}

export type HarnessNotificationTone = 'success' | 'failure' | 'neutral';

export interface HarnessNotificationPresentation {
  /** Header label, e.g. "Background task failed". */
  label: string;
  tone: HarnessNotificationTone;
  notifications: TaskNotification[];
}

export interface HarnessTextPresentation {
  /** The text with every recognized harness block replaced by its readable form. */
  text: string;
  /**
   * Set when the text was nothing but harness notifications. Such text is the harness reporting
   * on the agent's own work, not a person speaking, and must not render as a user follow-up.
   */
  notification: HarnessNotificationPresentation | null;
}

const TASK_NOTIFICATION_BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/gi;

/** Blocks that are harness bookkeeping with nothing for a reader; dropped outright. */
const DROPPED_BLOCKS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi
];

/** Wrappers whose content is worth keeping once the tags themselves are gone. */
const UNWRAPPED_TAGS = [
  'local-command-stdout',
  'local-command-stderr',
  'bash-stdout',
  'bash-stderr'
];

const COMMAND_BLOCK =
  /<command-message>[\s\S]*?<\/command-message>|<command-name>([\s\S]*?)<\/command-name>|<command-args>([\s\S]*?)<\/command-args>/gi;

function tagValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/** Every `<task-notification>` block in `text`, in order of appearance. */
export function parseTaskNotifications(text: string): TaskNotification[] {
  const notifications: TaskNotification[] = [];
  for (const match of text.matchAll(TASK_NOTIFICATION_BLOCK)) {
    const block = match[1] ?? '';
    notifications.push({
      taskId: tagValue(block, 'task-id'),
      toolUseId: tagValue(block, 'tool-use-id'),
      outputFile: tagValue(block, 'output-file'),
      status: tagValue(block, 'status'),
      summary: tagValue(block, 'summary')
    });
  }
  return notifications;
}

function statusTone(status: string | null): HarnessNotificationTone {
  switch (status?.toLowerCase()) {
    case 'completed':
    case 'complete':
    case 'succeeded':
    case 'success':
      return 'success';
    case 'failed':
    case 'failure':
    case 'error':
    case 'killed':
    case 'timeout':
    case 'timed_out':
      return 'failure';
    default:
      return 'neutral';
  }
}

function statusWord(status: string | null): string {
  const normalized = status?.trim().toLowerCase().replace(/_/g, ' ');
  if (!normalized) return 'updated';
  if (normalized === 'complete' || normalized === 'succeeded' || normalized === 'success') {
    return 'completed';
  }
  return normalized;
}

/** One readable line for a notification: the harness's own summary when it wrote one. */
export function formatTaskNotification(notification: TaskNotification): string {
  if (notification.summary) return notification.summary;
  const subject = notification.taskId
    ? `Background task ${notification.taskId}`
    : 'Background task';
  return `${subject} ${statusWord(notification.status)}`;
}

function notificationPresentation(
  notifications: TaskNotification[]
): HarnessNotificationPresentation {
  const tones = notifications.map(notification => statusTone(notification.status));
  const tone: HarnessNotificationTone = tones.includes('failure')
    ? 'failure'
    : tones.every(value => value === 'success')
      ? 'success'
      : 'neutral';
  const label =
    notifications.length === 1
      ? `Background task ${statusWord(notifications[0]!.status)}`
      : `${notifications.length} background task updates`;
  return { label, tone, notifications };
}

function formatCommandBlocks(text: string): string {
  // A slash-command invocation is a name/message/args triple; collapse it to "/name args".
  return text.replace(
    /(?:<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>\s*)+/gi,
    run => {
      let name = '';
      let args = '';
      for (const match of run.matchAll(COMMAND_BLOCK)) {
        if (match[1] !== undefined) name = match[1].trim();
        if (match[2] !== undefined) args = match[2].trim();
      }
      const line = [name, args].filter(Boolean).join(' ');
      return line ? `${line}\n` : '';
    }
  );
}

/** Rewrite harness markup in a summary into readable text, and flag harness-only messages. */
export function presentAgentHarnessText(raw: string): HarnessTextPresentation {
  if (!raw.includes('<')) return { text: raw, notification: null };

  const notifications = parseTaskNotifications(raw);
  let text = raw;
  for (const pattern of DROPPED_BLOCKS) text = text.replace(pattern, '');

  // Measure what the user actually wrote before notifications are expanded into prose.
  const remainder = text.replace(TASK_NOTIFICATION_BLOCK, '').trim();

  let index = 0;
  // Swallow the whitespace after each block so consecutive notifications land one per line.
  text = text.replace(/<task-notification>[\s\S]*?<\/task-notification>\s*/gi, () => {
    const notification = notifications[index++];
    return notification ? `${formatTaskNotification(notification)}\n` : '';
  });
  text = formatCommandBlocks(text);
  for (const tag of UNWRAPPED_TAGS) {
    text = text.replace(new RegExp(`</?${tag}>`, 'gi'), '');
  }
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return {
    text,
    notification:
      notifications.length > 0 && remainder === '' ? notificationPresentation(notifications) : null
  };
}

/** Readable form of a summary for surfaces that show plain text only (feed cards, previews). */
export function formatAgentHarnessText(raw: string): string {
  return presentAgentHarnessText(raw).text;
}
