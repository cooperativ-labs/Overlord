import { buildFeedDiscussLayeredTaskMarkdown } from '@/lib/overlord/feed-discuss-appendix';
import type { Database } from '@/types/database.types';

type FeedPostRow = Database['public']['Tables']['feed_posts']['Row'];

describe('buildFeedDiscussLayeredTaskMarkdown', () => {
  it('orders intent, execution facts, interpretation, then question', () => {
    const feedPost: FeedPostRow = {
      id: 'feed-uuid',
      title: 'Shipped feature X',
      body: 'Did the thing.',
      summary: 'Did the thing.',
      impact_level: 'medium',
      agent_type: 'cursor',
      session_id: 'sess-1',
      objective_id: 'obj-1',
      tradeoffs: [
        {
          decision: 'Use A',
          alternatives_considered: 'B',
          rationale: 'Less risk'
        }
      ],
      human_actions: ['Review PR'],
      files_touched: ['src/a.ts'],
      tickets_created: [{ title: 'Follow-up', id: 't2', sequence: 2, reference: '1:100' }],
      organization_id: 1,
      ticket_id: 'ticket-uuid',
      project_id: 'proj-uuid',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      created_by: null,
      source_event_ids: [],
      source_session_ids: ['sess-1'],
      objective_sections: [],
      orphan_file_changes: [],
      total_events: 0,
      total_files: 1,
      pending_actions: 1,
      source_window_end: null,
      source_window_start: null,
      tags: []
    };

    const md = buildFeedDiscussLayeredTaskMarkdown({
      feedPost,
      feedPostId: 'feed-uuid',
      ticketIntent: {
        humanTicketId: '1:1',
        ticketTitle: 'Parent ticket',
        sliceObjectiveText: 'Implement X',
        acceptanceCriteria: 'Tests pass',
        constraints: 'None',
        executionTarget: 'agent'
      },
      fileChanges: [
        {
          file_path: 'src/a.ts',
          summary: 'Add fn',
          why: 'needed',
          impact: 'behavior'
        }
      ],
      ticketEvents: [
        {
          created_at: '2026-01-02T00:00:00Z',
          event_type: 'update',
          summary: 'Progress'
        }
      ],
      initialQuestion: 'Was this the right tradeoff?'
    });

    const intent = md.indexOf('### 1. Ticket intent');
    const exec = md.indexOf('### 2. Execution facts');
    const interp = md.indexOf('### 3. Synthesized interpretation');
    const q = md.indexOf('### 4. Your question');

    expect(intent).toBeGreaterThan(-1);
    expect(exec).toBeGreaterThan(intent);
    expect(interp).toBeGreaterThan(exec);
    expect(q).toBeGreaterThan(interp);
    expect(md).toContain('**Ticket ID:** 1:1');
    expect(md).toContain('**Feed post id:** `feed-uuid`');
    expect(md).toContain('Was this the right tradeoff?');
    expect(md.slice(q)).toContain('Was this the right tradeoff?');
  });
});
