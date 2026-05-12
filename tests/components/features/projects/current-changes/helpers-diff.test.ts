import {
  buildCurrentChangePathVariants,
  normalizeCurrentChangePath,
  rationaleIntersectsParsedDiff
} from '@/components/features/projects/current-changes/helpers';
import type { FileChangeRecord } from '@/components/features/projects/current-changes/types';
import { parseUnifiedDiff } from '@/lib/git/unified-diff';

function makeRationale(
  overrides: Partial<FileChangeRecord> & { id: string; file_path: string }
): FileChangeRecord {
  return {
    attribution_source: 'agent',
    change_kind: 'edit',
    checkpoint: null,
    checkpoint_id: null,
    confidence: 'high',
    created_at: '2026-05-10T00:00:00Z',
    event: null,
    file_name: overrides.file_path.split('/').pop() ?? overrides.file_path,
    hunks: [],
    impact: '',
    label: '',
    objective: null,
    session: null,
    summary: 's',
    ticket: {
      id: 't1',
      latest_objective_agent: null,
      objective: null,
      status: 'execute',
      ticket_id: 't1',
      title: 'T'
    },
    updated_at: '2026-05-10T00:00:00Z',
    why: '',
    ...overrides
  };
}

describe('rationaleIntersectsParsedDiff', () => {
  const diffText = `--- a/src/a.ts
+++ b/src/a.ts
@@ -10,1 +10,2 @@
 context
+inserted
`;

  it('returns true when rationale hunks overlap a parsed diff hunk', () => {
    const parsed = parseUnifiedDiff(diffText);
    const rationale = makeRationale({
      id: 'r1',
      file_path: 'src/a.ts',
      hunks: [{ new_start: 10, new_lines: 2, old_start: 10, old_lines: 1 }]
    });
    expect(rationaleIntersectsParsedDiff(rationale, parsed)).toBe(true);
  });

  it('returns false when rationale has no hunks', () => {
    const parsed = parseUnifiedDiff(diffText);
    const rationale = makeRationale({ id: 'r1', file_path: 'src/a.ts', hunks: [] });
    expect(rationaleIntersectsParsedDiff(rationale, parsed)).toBe(false);
  });

  it('returns false when rationale hunks do not overlap the diff', () => {
    const parsed = parseUnifiedDiff(diffText);
    const rationale = makeRationale({
      id: 'r1',
      file_path: 'src/a.ts',
      hunks: [{ new_start: 99, new_lines: 1, old_start: 99, old_lines: 1 }]
    });
    expect(rationaleIntersectsParsedDiff(rationale, parsed)).toBe(false);
  });

  it('returns false when parsed diff is null or has no hunks', () => {
    const rationale = makeRationale({
      id: 'r1',
      file_path: 'src/a.ts',
      hunks: [{ new_start: 10, new_lines: 2, old_start: 10, old_lines: 1 }]
    });
    expect(rationaleIntersectsParsedDiff(rationale, null)).toBe(false);
    expect(
      rationaleIntersectsParsedDiff(rationale, { hunks: [], newPath: null, oldPath: null, raw: '' })
    ).toBe(false);
  });
});

describe('current change path helpers', () => {
  it('normalizes common rationale path forms to repo-relative paths', () => {
    expect(normalizeCurrentChangePath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizeCurrentChangePath('/repo/src/a.ts', ['/repo'])).toBe('src/a.ts');
    expect(normalizeCurrentChangePath('src\\a.ts')).toBe('src/a.ts');
  });

  it('builds lookup variants for recorded relative and absolute paths', () => {
    expect(buildCurrentChangePathVariants('src/a.ts', ['/repo'])).toEqual([
      'src/a.ts',
      './src/a.ts',
      '/repo/src/a.ts'
    ]);
  });
});
