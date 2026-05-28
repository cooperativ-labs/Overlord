import type {
  GraphApiResponse,
  GraphFileChangeRecord,
  HotspotRecord
} from '@/components/features/projects/graph/types';
import { emptyFilters } from '@/components/features/projects/graph/types';
import {
  buildDiffLanesLayout,
  buildGraphViewModel,
  buildHotspotViewModel
} from '@/components/features/projects/graph/view-model';

function makeFileChange(input: {
  id: string;
  ticketId: string;
  filePath: string;
  createdAt?: string;
  changeKind?: string;
  impact?: string;
  ticketShortId?: string;
  ticketStatusType?: string | null;
}): GraphFileChangeRecord {
  return {
    id: input.id,
    file_name: input.filePath.split('/').pop()!,
    file_path: input.filePath,
    label: 'l',
    summary: 's',
    why: 'w',
    impact: input.impact ?? 'medium',
    change_kind: input.changeKind ?? 'modify',
    attribution_source: 'agent',
    confidence: 'high',
    hunks: null,
    created_at: input.createdAt ?? '2026-01-01T00:00:00Z',
    updated_at: input.createdAt ?? '2026-01-01T00:00:00Z',
    ticket_id: input.ticketId,
    event_id: 'e',
    session_id: 'sess',
    checkpoint_id: null,
    objective_id: null,
    ticket: {
      id: input.ticketId,
      ticket_id: input.ticketShortId ?? '1:1',
      title: 'T',
      status: 'execute',
      project_id: 'p',
      status_type: input.ticketStatusType ?? 'execute'
    },
    event: null,
    session: null,
    checkpoint: null,
    objective: null
  };
}

describe('buildGraphViewModel - time window filtering', () => {
  const data: GraphApiResponse = {
    tickets: [],
    fileChanges: [
      makeFileChange({
        id: 'a',
        ticketId: 'T1',
        filePath: 'src/a.ts',
        createdAt: '2026-01-01T00:00:00Z'
      }),
      makeFileChange({
        id: 'b',
        ticketId: 'T1',
        filePath: 'src/b.ts',
        createdAt: '2026-02-01T00:00:00Z'
      }),
      makeFileChange({
        id: 'c',
        ticketId: 'T2',
        filePath: 'src/c.ts',
        createdAt: '2026-03-01T00:00:00Z'
      })
    ]
  };

  it('computes timeBounds across the full dataset regardless of maxTime', () => {
    const vm = buildGraphViewModel(data, { ...emptyFilters(), maxTime: '2026-01-15T00:00:00Z' });
    expect(vm.timeBounds).toEqual({ min: '2026-01-01T00:00:00Z', max: '2026-03-01T00:00:00Z' });
  });

  it('hides rationales newer than maxTime', () => {
    const vm = buildGraphViewModel(data, { ...emptyFilters(), maxTime: '2026-01-15T00:00:00Z' });
    expect(vm.edges.filter(e => e.type === 'rationale')).toHaveLength(1);
    expect(vm.fileNodes.size).toBe(1);
  });

  it('shows all rationales when maxTime is null', () => {
    const vm = buildGraphViewModel(data, emptyFilters());
    expect(vm.edges.filter(e => e.type === 'rationale')).toHaveLength(3);
    expect(vm.fileNodes.size).toBe(3);
  });
});

describe('buildHotspotViewModel', () => {
  it('returns empty layout when there are no hotspots', () => {
    const vm = buildHotspotViewModel([], 30);
    expect(vm.nodes).toHaveLength(0);
    expect(vm.windowDays).toBe(30);
  });

  it('produces one node per hotspot, grouped horizontally by top directory', () => {
    const hotspots: HotspotRecord[] = [
      {
        file_path: 'src/a.ts',
        file_name: 'a.ts',
        ticket_count: 3,
        rationale_count: 4,
        high_impact_count: 1,
        medium_impact_count: 3,
        low_impact_count: 0,
        impact_score: 9,
        last_activity: '2026-01-03T00:00:00Z',
        ticket_ids: ['t1', 't2', 't3']
      },
      {
        file_path: 'tests/b.ts',
        file_name: 'b.ts',
        ticket_count: 1,
        rationale_count: 1,
        high_impact_count: 0,
        medium_impact_count: 1,
        low_impact_count: 0,
        impact_score: 2,
        last_activity: '2026-01-02T00:00:00Z',
        ticket_ids: ['t1']
      }
    ];
    const vm = buildHotspotViewModel(hotspots, 90);
    expect(vm.nodes).toHaveLength(2);
    const xs = vm.nodes.map(n => n.position.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBeGreaterThan(0);
  });
});

describe('buildDiffLanesLayout', () => {
  it('separates shared, only-A, and only-B files into lanes', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        makeFileChange({ id: '1', ticketId: 'A', filePath: 'src/shared.ts' }),
        makeFileChange({ id: '2', ticketId: 'B', filePath: 'src/shared.ts' }),
        makeFileChange({ id: '3', ticketId: 'A', filePath: 'src/onlyA.ts' }),
        makeFileChange({ id: '4', ticketId: 'B', filePath: 'src/onlyB.ts' })
      ]
    };
    const vm = buildGraphViewModel(data, emptyFilters());
    const layout = buildDiffLanesLayout(vm, 'A', 'B')!;
    expect(layout.shared).toEqual(['src/shared.ts']);
    expect(layout.onlyA).toEqual(['src/onlyA.ts']);
    expect(layout.onlyB).toEqual(['src/onlyB.ts']);

    const xA = layout.positions.get('ticket-A')!.x;
    const xB = layout.positions.get('ticket-B')!.x;
    const xShared = layout.positions.get('file-src/shared.ts')!.x;
    const xOnlyA = layout.positions.get('file-src/onlyA.ts')!.x;
    const xOnlyB = layout.positions.get('file-src/onlyB.ts')!.x;

    expect(xA).toBeLessThan(xOnlyA);
    expect(xOnlyA).toBeLessThan(xShared);
    expect(xShared).toBeLessThan(xOnlyB);
    expect(xOnlyB).toBeLessThan(xB);
  });
});
