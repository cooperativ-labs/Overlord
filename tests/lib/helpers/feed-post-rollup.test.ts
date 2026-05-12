import {
  lastRollupObjectiveId,
  normalizeFeedRollupObjectiveSections,
  normalizeFeedRollupOrphanFiles
} from '@/lib/helpers/feed-post-rollup';

describe('normalizeFeedRollupObjectiveSections', () => {
  it('parses objective rows and sorts by index', () => {
    const sections = normalizeFeedRollupObjectiveSections([
      {
        id: 'b',
        objective_id: 'obj-b',
        index: 2,
        title: 'Second',
        state: 'completed',
        position: 1,
        time: '1:00 PM',
        duration: '5m',
        events: 2,
        takeaway: 'T2',
        body: '- line',
        file_changes: [{ path: 'a.ts', status: 'modified', additions: 1, deletions: 0 }],
        action_required: ['Run migration'],
        tradeoffs: [
          {
            decision: 'Pick A',
            alternatives_considered: 'B',
            rationale: 'Because'
          }
        ],
        event_ids: ['e1'],
        updated_at: '2026-01-01'
      },
      {
        id: 'a',
        objective_id: 'obj-a',
        index: 1,
        title: 'First',
        state: 'completed',
        position: 0,
        events: 1,
        takeaway: 'T1',
        body: '- x'
      }
    ]);

    expect(sections.map(s => s.objective_id)).toEqual(['obj-a', 'obj-b']);
    expect(sections[0]?.file_changes).toEqual([]);
    expect(sections[1]?.file_changes[0]?.path).toBe('a.ts');
    expect(sections[1]?.action_required).toEqual(['Run migration']);
    expect(sections[1]?.tradeoffs[0]?.decision).toBe('Pick A');
  });

  it('drops invalid rows', () => {
    expect(normalizeFeedRollupObjectiveSections([{ objective_id: '' }])).toEqual([]);
    expect(normalizeFeedRollupObjectiveSections(null)).toEqual([]);
  });
});

describe('normalizeFeedRollupOrphanFiles', () => {
  it('maps orphan file changes', () => {
    const files = normalizeFeedRollupOrphanFiles([
      { path: 'README.md', status: 'added', additions: 2, deletions: null, note: 'orphan' }
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('README.md');
    expect(files[0]?.note).toBe('orphan');
  });
});

describe('lastRollupObjectiveId', () => {
  it('returns the last section objective id after sort', () => {
    const sections = normalizeFeedRollupObjectiveSections([
      { objective_id: 'z', index: 2, title: 'B' },
      { objective_id: 'y', index: 1, title: 'A' }
    ]);
    expect(lastRollupObjectiveId(sections)).toBe('z');
  });
});
