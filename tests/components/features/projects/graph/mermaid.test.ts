import { buildMermaidExport } from '@/components/features/projects/graph/export/mermaid';
import type { GraphApiResponse } from '@/components/features/projects/graph/types';

function ticketFc(input: {
  id: string;
  ticketId: string;
  shortId: string;
  filePath: string;
  changeKind?: string;
}) {
  return {
    id: input.id,
    file_name: input.filePath.split('/').pop()!,
    file_path: input.filePath,
    label: 'Updated handler',
    summary: '',
    why: '',
    impact: 'medium',
    change_kind: input.changeKind ?? 'modify',
    attribution_source: 'agent',
    confidence: 'high',
    hunks: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ticket_id: input.ticketId,
    event_id: 'e',
    session_id: 's',
    checkpoint_id: null,
    objective_id: null,
    ticket: {
      id: input.ticketId,
      ticket_id: input.shortId,
      title: 'Some title',
      status: 'execute',
      project_id: 'p',
      status_type: 'execute'
    },
    event: null,
    session: null,
    checkpoint: null,
    objective: null
  };
}

describe('buildMermaidExport', () => {
  it('returns a placeholder when there are no file changes', () => {
    const data: GraphApiResponse = { tickets: [], fileChanges: [] };
    const out = buildMermaidExport(data);
    expect(out).toContain('flowchart LR');
    expect(out).toContain('No file changes');
  });

  it('emits a node for each ticket and file, with directional edges', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        ticketFc({ id: '1', ticketId: 'T_A', shortId: '1:1', filePath: 'src/a.ts' }),
        ticketFc({ id: '2', ticketId: 'T_A', shortId: '1:1', filePath: 'src/b.ts' }),
        ticketFc({
          id: '3',
          ticketId: 'T_B',
          shortId: '1:2',
          filePath: 'src/a.ts',
          changeKind: 'delete'
        })
      ]
    };
    const out = buildMermaidExport(data);
    expect(out).toContain('1:1');
    expect(out).toContain('1:2');
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
    // dashed arrow for delete
    expect(out).toMatch(/-\.->/);
    // solid arrow for modify
    expect(out).toMatch(/-->\|/);
    expect(out).toContain('```mermaid');
  });

  it('deduplicates ticket→file edges per pair', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        ticketFc({ id: '1', ticketId: 'T_A', shortId: '1:1', filePath: 'src/a.ts' }),
        ticketFc({ id: '2', ticketId: 'T_A', shortId: '1:1', filePath: 'src/a.ts' })
      ]
    };
    const out = buildMermaidExport(data);
    const arrowCount = (out.match(/T_T_A.*-->/g) ?? []).length;
    expect(arrowCount).toBe(1);
  });
});
