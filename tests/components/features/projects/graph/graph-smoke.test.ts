import type {
  GraphApiResponse,
  GraphFileChangeRecord
} from '@/components/features/projects/graph/types';
import { emptyFilters } from '@/components/features/projects/graph/types';
import {
  aggregateToDirectories,
  buildGraphViewModel,
  LARGE_GRAPH_NODE_THRESHOLD
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
    label: 'Updated',
    summary: 'summary',
    why: 'why',
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
      title: 'Test ticket',
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

describe('Graph smoke tests — core navigation', () => {
  it('builds a view model from a single ticket with files', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        makeFileChange({ id: '1', ticketId: 'T1', filePath: 'src/a.ts' }),
        makeFileChange({ id: '2', ticketId: 'T1', filePath: 'src/b.ts' }),
        makeFileChange({ id: '3', ticketId: 'T1', filePath: 'lib/c.ts' })
      ]
    };

    const vm = buildGraphViewModel(data, emptyFilters());

    expect(vm.ticketNodes.size).toBe(1);
    expect(vm.fileNodes.size).toBe(3);
    expect(vm.edges.length).toBe(3);
    expect(vm.nodes.length).toBe(4);
    expect(vm.allDirectories).toContain('src');
    expect(vm.allDirectories).toContain('lib');
  });

  it('builds co-change edges for multi-ticket compare set', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        makeFileChange({ id: '1', ticketId: 'T1', filePath: 'src/shared.ts' }),
        makeFileChange({ id: '2', ticketId: 'T2', filePath: 'src/shared.ts' }),
        makeFileChange({ id: '3', ticketId: 'T1', filePath: 'src/only-t1.ts' }),
        makeFileChange({ id: '4', ticketId: 'T2', filePath: 'src/only-t2.ts' })
      ]
    };

    const vm = buildGraphViewModel(data, emptyFilters());

    expect(vm.ticketNodes.size).toBe(2);
    expect(vm.fileNodes.size).toBe(3);
    expect(vm.coChangeEdges.length).toBe(1);
    const coChange = vm.coChangeEdges[0];
    expect((coChange.data as { sharedFileCount: number }).sharedFileCount).toBe(1);
  });

  it('handles empty data gracefully', () => {
    const data: GraphApiResponse = { tickets: [], fileChanges: [] };
    const vm = buildGraphViewModel(data, emptyFilters());

    expect(vm.nodes.length).toBe(0);
    expect(vm.edges.length).toBe(0);
    expect(vm.ticketNodes.size).toBe(0);
    expect(vm.fileNodes.size).toBe(0);
    expect(vm.timeBounds).toBeNull();
    expect(vm.isLargeGraph).toBe(false);
  });

  it('computes allChangeKinds and allImpacts for filter population', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        makeFileChange({
          id: '1',
          ticketId: 'T1',
          filePath: 'src/a.ts',
          changeKind: 'create',
          impact: 'high'
        }),
        makeFileChange({
          id: '2',
          ticketId: 'T1',
          filePath: 'src/b.ts',
          changeKind: 'modify',
          impact: 'low'
        }),
        makeFileChange({
          id: '3',
          ticketId: 'T1',
          filePath: 'src/c.ts',
          changeKind: 'delete',
          impact: 'medium'
        })
      ]
    };

    const vm = buildGraphViewModel(data, emptyFilters());

    expect(vm.allChangeKinds.sort()).toEqual(['create', 'delete', 'modify']);
    expect(vm.allImpacts.sort()).toEqual(['high', 'low', 'medium']);
  });
});

describe('Graph smoke tests — filtering', () => {
  const data: GraphApiResponse = {
    tickets: [],
    fileChanges: [
      makeFileChange({ id: '1', ticketId: 'T1', filePath: 'src/a.ts', changeKind: 'create' }),
      makeFileChange({ id: '2', ticketId: 'T1', filePath: 'lib/b.ts', changeKind: 'modify' }),
      makeFileChange({ id: '3', ticketId: 'T2', filePath: 'src/c.ts', changeKind: 'delete' })
    ]
  };

  it('dims nodes not matching directory filter', () => {
    const filters = { ...emptyFilters(), directories: new Set(['lib']) };
    const vm = buildGraphViewModel(data, filters);

    const srcFiles = [...vm.fileNodes.values()].filter(
      n => (n.data as { directory: string }).directory === 'src'
    );
    const libFiles = [...vm.fileNodes.values()].filter(
      n => (n.data as { directory: string }).directory === 'lib'
    );

    expect(srcFiles.every(n => (n.data as { dimmed: boolean }).dimmed)).toBe(true);
    expect(libFiles.every(n => !(n.data as { dimmed: boolean }).dimmed)).toBe(true);
  });

  it('dims nodes not matching changeKind filter', () => {
    const filters = { ...emptyFilters(), changeKinds: new Set(['create']) };
    const vm = buildGraphViewModel(data, filters);

    const modifyFile = vm.fileNodes.get('lib/b.ts');
    expect((modifyFile?.data as { dimmed: boolean }).dimmed).toBe(true);
  });
});

describe('Graph smoke tests — large graph guardrails', () => {
  it('flags isLargeGraph when node count exceeds threshold', () => {
    const fileChanges: GraphFileChangeRecord[] = [];
    for (let i = 0; i < LARGE_GRAPH_NODE_THRESHOLD + 10; i++) {
      fileChanges.push(
        makeFileChange({
          id: `fc-${i}`,
          ticketId: 'T1',
          filePath: `src/file${i}.ts`
        })
      );
    }
    const data: GraphApiResponse = { tickets: [], fileChanges };
    const vm = buildGraphViewModel(data, emptyFilters());

    expect(vm.isLargeGraph).toBe(true);
    expect(vm.fileNodes.size).toBeGreaterThan(LARGE_GRAPH_NODE_THRESHOLD);
  });

  it('aggregateToDirectories collapses files into directory super-nodes', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        makeFileChange({ id: '1', ticketId: 'T1', filePath: 'src/a.ts' }),
        makeFileChange({ id: '2', ticketId: 'T1', filePath: 'src/b.ts' }),
        makeFileChange({ id: '3', ticketId: 'T1', filePath: 'src/c.ts' }),
        makeFileChange({ id: '4', ticketId: 'T1', filePath: 'lib/d.ts' }),
        makeFileChange({ id: '5', ticketId: 'T2', filePath: 'src/a.ts' })
      ]
    };

    const vm = buildGraphViewModel(data, emptyFilters());
    expect(vm.fileNodes.size).toBe(4);

    const aggregated = aggregateToDirectories(vm);

    expect(aggregated.fileNodes.size).toBe(2);
    expect(aggregated.fileNodes.has('src')).toBe(true);
    expect(aggregated.fileNodes.has('lib')).toBe(true);
    expect(aggregated.aggregatedFileCount).toBe(4);
    expect(aggregated.isLargeGraph).toBe(true);

    const srcNode = aggregated.fileNodes.get('src')!;
    expect((srcNode.data as { ticketCount: number }).ticketCount).toBe(2);
    expect((srcNode.data as { fileName: string }).fileName).toContain('3 files');
  });

  it('aggregation deduplicates edges to same directory', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        makeFileChange({ id: '1', ticketId: 'T1', filePath: 'src/a.ts' }),
        makeFileChange({ id: '2', ticketId: 'T1', filePath: 'src/b.ts' })
      ]
    };

    const vm = buildGraphViewModel(data, emptyFilters());
    expect(vm.edges.filter(e => e.type === 'rationale').length).toBe(2);

    const aggregated = aggregateToDirectories(vm);
    const rationaleEdges = aggregated.edges.filter(e => e.type !== 'cochange');
    expect(rationaleEdges.length).toBe(1);
  });
});

describe('Graph smoke tests — time bounds and replay', () => {
  it('maintains stable timeBounds under maxTime filtering', () => {
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
          createdAt: '2026-06-01T00:00:00Z'
        })
      ]
    };

    const vm = buildGraphViewModel(data, {
      ...emptyFilters(),
      maxTime: '2026-03-01T00:00:00Z'
    });

    expect(vm.timeBounds).toEqual({
      min: '2026-01-01T00:00:00Z',
      max: '2026-06-01T00:00:00Z'
    });
    expect(vm.fileNodes.size).toBe(1);
    expect(vm.edges.filter(e => e.type === 'rationale').length).toBe(1);
  });
});

describe('Graph smoke tests — edge styling', () => {
  it('applies change_kind colors and impact stroke widths to edges', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        makeFileChange({
          id: '1',
          ticketId: 'T1',
          filePath: 'src/a.ts',
          changeKind: 'create',
          impact: 'high'
        }),
        makeFileChange({
          id: '2',
          ticketId: 'T1',
          filePath: 'src/b.ts',
          changeKind: 'delete',
          impact: 'low'
        })
      ]
    };

    const vm = buildGraphViewModel(data, emptyFilters());
    const createEdge = vm.edges.find(e => e.id.includes('src/a.ts'));
    const deleteEdge = vm.edges.find(e => e.id.includes('src/b.ts'));

    expect(createEdge?.style?.stroke).toBe('#22c55e');
    expect(createEdge?.style?.strokeWidth).toBe(3);
    expect(deleteEdge?.style?.stroke).toBe('#ef4444');
    expect(deleteEdge?.style?.strokeWidth).toBe(1);
  });

  it('applies amber color and dash pattern to co-change edges', () => {
    const data: GraphApiResponse = {
      tickets: [],
      fileChanges: [
        makeFileChange({ id: '1', ticketId: 'T1', filePath: 'src/shared.ts' }),
        makeFileChange({ id: '2', ticketId: 'T2', filePath: 'src/shared.ts' })
      ]
    };

    const vm = buildGraphViewModel(data, emptyFilters());
    expect(vm.coChangeEdges.length).toBe(1);
    const edge = vm.coChangeEdges[0];
    expect(edge.style?.stroke).toBe('#f59e0b');
    expect(edge.style?.strokeDasharray).toBe('6 3');
  });
});
