import type {
  FileChangeRecord,
  GitStatusFile
} from '@/components/features/projects/current-changes/types';
import {
  buildEnrichedCurrentChangeFiles,
  countFilesPerTicket,
  pruneTicketFilterSelection,
  ticketFilterSelectionsEqual,
  ticketIdsTouchingCurrentChanges
} from '@/components/features/projects/current-changes/view-model';

function makeFile(input: Partial<GitStatusFile> & { path: string }): GitStatusFile {
  return {
    linesAdded: null,
    linesRemoved: null,
    originalPath: null,
    stagedStatus: ' ',
    status: 'modified',
    unstagedStatus: 'M',
    ...input
  };
}

function makeRationale(input: {
  id: string;
  filePath: string;
  ticketId: string;
  ticketStatus: string;
  ticketTitle?: string;
  createdAt: string;
  summary?: string;
}): FileChangeRecord {
  return {
    attribution_source: 'agent',
    change_kind: 'edit',
    confidence: 'high',
    created_at: input.createdAt,
    event: null,
    file_name: input.filePath.split('/').pop() ?? input.filePath,
    file_path: input.filePath,
    hunks: [],
    id: input.id,
    impact: '',
    jj_change_id: null,
    jj_commit_id: null,
    jj_operation_id: null,
    label: '',
    session: null,
    snapshot_backend: null,
    summary: input.summary ?? 'rationale summary',
    ticket: {
      id: input.ticketId,
      latest_objective_agent: null,
      objective: null,
      status: input.ticketStatus,
      ticket_id: input.ticketId,
      title: input.ticketTitle ?? `Ticket ${input.ticketId}`
    },
    updated_at: input.createdAt,
    why: '',
    workspace_name: null,
    workspace_path: null
  };
}

describe('current-changes view-model', () => {
  it('surfaces rationales for any ticket state, not just review', () => {
    const files = [makeFile({ path: 'src/a.ts' })];
    const rationales = [
      makeRationale({
        id: 'r-exec',
        filePath: 'src/a.ts',
        ticketId: 't-exec',
        ticketStatus: 'execute',
        createdAt: '2026-05-10T00:00:00Z'
      }),
      makeRationale({
        id: 'r-review',
        filePath: 'src/a.ts',
        ticketId: 't-review',
        ticketStatus: 'review',
        createdAt: '2026-05-11T00:00:00Z'
      })
    ];

    const [enriched] = buildEnrichedCurrentChangeFiles({ files, rationales });

    expect(enriched.fileChangeCount).toBe(2);
    expect(enriched.tickets.map(ticket => ticket.id)).toEqual(['t-review', 't-exec']);
    expect(enriched.primaryTicket?.id).toBe('t-review');
  });

  it('falls back to a status-aware summary when no rationale is linked', () => {
    const files = [
      makeFile({ path: 'docs/new.md', status: 'added' }),
      makeFile({ path: 'docs/old.md', status: 'deleted' })
    ];

    const [added, deleted] = buildEnrichedCurrentChangeFiles({ files, rationales: [] });

    expect(added.summary).toMatch(/new file/i);
    expect(deleted.summary).toMatch(/deleted file/i);
    expect(added.tickets).toHaveLength(0);
  });

  it('matches rationales recorded under originalPath when a file is renamed', () => {
    const files = [
      makeFile({
        path: 'src/renamed.ts',
        originalPath: 'src/original.ts',
        status: 'renamed'
      })
    ];
    const rationales = [
      makeRationale({
        id: 'r1',
        filePath: 'src/original.ts',
        ticketId: 't1',
        ticketStatus: 'execute',
        createdAt: '2026-05-09T00:00:00Z'
      })
    ];

    const [enriched] = buildEnrichedCurrentChangeFiles({ files, rationales });
    expect(enriched.tickets.map(ticket => ticket.id)).toEqual(['t1']);
  });

  it('counts each file once per ticket', () => {
    const files = [makeFile({ path: 'src/a.ts' }), makeFile({ path: 'src/b.ts' })];
    const rationales = [
      makeRationale({
        id: 'r1',
        filePath: 'src/a.ts',
        ticketId: 't1',
        ticketStatus: 'review',
        createdAt: '2026-05-10T00:00:00Z'
      }),
      makeRationale({
        id: 'r2',
        filePath: 'src/a.ts',
        ticketId: 't1',
        ticketStatus: 'review',
        createdAt: '2026-05-11T00:00:00Z'
      }),
      makeRationale({
        id: 'r3',
        filePath: 'src/b.ts',
        ticketId: 't1',
        ticketStatus: 'review',
        createdAt: '2026-05-11T00:00:00Z'
      }),
      makeRationale({
        id: 'r4',
        filePath: 'src/b.ts',
        ticketId: 't2',
        ticketStatus: 'execute',
        createdAt: '2026-05-11T00:00:00Z'
      })
    ];

    const enriched = buildEnrichedCurrentChangeFiles({ files, rationales });
    const counts = countFilesPerTicket(enriched);

    expect(counts.get('t1')).toBe(2);
    expect(counts.get('t2')).toBe(1);
  });

  it('collects ticket ids that touch current changes', () => {
    const files = [makeFile({ path: 'src/a.ts' }), makeFile({ path: 'src/b.ts' })];
    const rationales = [
      makeRationale({
        id: 'r1',
        filePath: 'src/a.ts',
        ticketId: 't1',
        ticketStatus: 'review',
        createdAt: '2026-05-10T00:00:00Z'
      }),
      makeRationale({
        id: 'r2',
        filePath: 'src/b.ts',
        ticketId: 't2',
        ticketStatus: 'execute',
        createdAt: '2026-05-11T00:00:00Z'
      })
    ];

    const enriched = buildEnrichedCurrentChangeFiles({ files, rationales });
    const touching = ticketIdsTouchingCurrentChanges(enriched);

    expect([...touching].sort()).toEqual(['t1', 't2']);
  });

  it('prunes ticket filter selections that no longer touch any file', () => {
    const pruned = pruneTicketFilterSelection({
      selectedTicketIds: new Set(['gone', 't1']),
      validTicketIds: new Set(['t1'])
    });

    expect([...pruned]).toEqual(['t1']);
  });

  it('detects equal ticket filter selections', () => {
    expect(ticketFilterSelectionsEqual(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(ticketFilterSelectionsEqual(new Set(['a']), new Set(['a', 'b']))).toBe(false);
  });
});
