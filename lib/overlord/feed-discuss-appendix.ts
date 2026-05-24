import type { Database } from '@/types/database.types';

type FeedPostRow = Database['public']['Tables']['feed_posts']['Row'];

type FileChangeSnippet = {
  file_path: string;
  summary: string | null;
  why: string | null;
  impact: string | null;
};

type TicketEventSnippet = {
  created_at: string;
  event_type: string;
  summary: string | null;
};

export type FeedDiscussTicketIntent = {
  humanTicketId: string;
  ticketTitle: string | null;
  sliceObjectiveText: string;
  acceptanceCriteria: string | null;
  constraints: string | null;
  forHuman: boolean | null;
};

export type FeedDiscussLayeredTaskInput = {
  feedPost: FeedPostRow;
  feedPostId: string;
  ticketIntent: FeedDiscussTicketIntent;
  fileChanges: FileChangeSnippet[];
  ticketEvents: TicketEventSnippet[];
  initialQuestion: string;
};

function formatTradeoffs(value: FeedPostRow['tradeoffs']): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  const lines = value
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const decision = String(row.decision ?? '').trim();
      if (!decision) return null;
      const alt = String(row.alternatives_considered ?? '').trim();
      const rationale = String(row.rationale ?? '').trim();
      const parts = [decision];
      if (alt) parts.push(`Alternatives: ${alt}`);
      if (rationale) parts.push(`Rationale: ${rationale}`);
      return `- ${parts.join(' — ')}`;
    })
    .filter((line): line is string => line !== null);
  return lines.join('\n');
}

function formatTicketsCreated(value: FeedPostRow['tickets_created']): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const title = String(row.title ?? '').trim();
      const id = String(row.id ?? '').trim();
      const seq = row.sequence;
      const ref = typeof row.reference === 'string' ? row.reference.trim() : '';
      if (!title) return null;
      const label = ref || (typeof seq === 'number' ? String(seq) : id.slice(0, 8));
      return `- ${label}: ${title}`;
    })
    .filter((line): line is string => line !== null)
    .join('\n');
}

/**
 * ## Task body for feed-post terminal / clipboard discussion.
 * Ordering: intent → execution facts → synthesized feed interpretation → user question.
 */
export function buildFeedDiscussLayeredTaskMarkdown(input: FeedDiscussLayeredTaskInput): string {
  const { feedPost, feedPostId, ticketIntent, fileChanges, ticketEvents, initialQuestion } = input;
  const tradeoffBlock = formatTradeoffs(feedPost.tradeoffs);
  const spawnedBlock = formatTicketsCreated(feedPost.tickets_created);
  const humanLines = (feedPost.human_actions ?? []).filter(Boolean);
  const fileLines = (feedPost.files_touched ?? []).filter(Boolean);

  const intentParts: string[] = [
    '### Feed discussion anchors',
    '',
    `- **Feed post title:** ${feedPost.title.trim() || '(Untitled)'}`,
    `- **Ticket ID:** ${ticketIntent.humanTicketId}`,
    `- **Feed post id:** \`${feedPostId}\``,
    '',
    '### 1. Ticket intent',
    '',
    `**Ticket title:** ${ticketIntent.ticketTitle?.trim() || '(Untitled)'}`,
    '',
    '**Objective for this work slice** (the slice summarized by this feed post, not necessarily the newest draft):',
    '',
    ticketIntent.sliceObjectiveText.trim(),
    ''
  ];

  if (ticketIntent.acceptanceCriteria?.trim()) {
    intentParts.push('**Acceptance criteria:**', '', ticketIntent.acceptanceCriteria.trim(), '');
  } else {
    intentParts.push('**Acceptance criteria:** _(none on file)_', '');
  }

  if (ticketIntent.constraints?.trim()) {
    intentParts.push('**Constraints:**', '', ticketIntent.constraints.trim(), '');
  } else {
    intentParts.push('**Constraints:** _(none on file)_', '');
  }

  intentParts.push(
    `**Execution target:** ${
      ticketIntent.forHuman === null ? 'unknown' : ticketIntent.forHuman ? 'human' : 'agent'
    }`,
    ''
  );

  const changeLines = fileChanges.map(
    row =>
      `- \`${row.file_path}\` — **summary:** ${(row.summary ?? '').trim() || '—'}; **why:** ${(row.why ?? '').trim() || '—'}; **impact:** ${(row.impact ?? '').trim() || '—'}`
  );
  const eventLines = ticketEvents.map(
    e =>
      `- \`${e.created_at}\` — **${e.event_type}:** ${(e.summary ?? '').trim() || '(no summary)'}`
  );

  const executionParts: string[] = [
    '### 2. Execution facts',
    '',
    '#### Ticket events (chronological, non-system)',
    '',
    eventLines.length > 0 ? eventLines.join('\n') : '_(No non-system ticket events in scope.)_',
    '',
    '#### File changes (summary / why / impact)',
    '',
    changeLines.length > 0 ? changeLines.join('\n') : '_(No file change rationales in scope.)_',
    ''
  ];

  const interpretationParts: string[] = [
    '### 3. Synthesized interpretation (feed post)',
    '',
    '**Body:**',
    '',
    feedPost.body.trim(),
    ''
  ];

  if (tradeoffBlock) {
    interpretationParts.push('**Tradeoffs (structured):**', '', tradeoffBlock, '');
  }

  if (humanLines.length > 0) {
    interpretationParts.push('**Human actions:**', '', ...humanLines.map(h => `- ${h}`), '');
  }

  if (fileLines.length > 0) {
    interpretationParts.push(
      '**Files touched (from feed):**',
      '',
      ...fileLines.map(f => `- \`${f}\``),
      ''
    );
  }

  if (spawnedBlock) {
    interpretationParts.push('**Tickets created (from feed):**', '', spawnedBlock, '');
  }

  const question =
    initialQuestion.trim() || '_(The user opened discuss without a typed question.)_';

  const parts = [
    ...intentParts,
    ...executionParts,
    ...interpretationParts,
    '### 4. Your question',
    '',
    question,
    '',
    'Use the layers above (intent → evidence → interpretation) together with Overlord protocol tools to respond. Prefer citing paths, events, and feed fields when grounding your answer.'
  ];

  return parts.join('\n');
}
