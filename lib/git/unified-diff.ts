export type ParsedDiffLine = {
  content: string;
  key: string;
  kind: 'add' | 'context' | 'del';
  newLineNumber: number | null;
  oldLineNumber: number | null;
};

export type ParsedDiffHunk = {
  header: string;
  id: string;
  lines: ParsedDiffLine[];
  newLines: number;
  newStart: number;
  oldLines: number;
  oldStart: number;
};

export type ParsedUnifiedDiff = {
  newPath: string | null;
  oldPath: string | null;
  raw: string;
  hunks: ParsedDiffHunk[];
};

function normalizeDiffPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/dev/null') return null;
  if (trimmed.startsWith('a/') || trimmed.startsWith('b/')) return trimmed.slice(2);
  return trimmed;
}

function parseRange(value: string): { count: number; start: number } {
  const [startRaw, countRaw] = value.split(',');
  const start = Number.parseInt(startRaw ?? '0', 10);
  const count = Number.parseInt(countRaw ?? '1', 10);
  return {
    count: Number.isFinite(count) ? count : 1,
    start: Number.isFinite(start) ? start : 0
  };
}

export function parseUnifiedDiff(diff: string): ParsedUnifiedDiff | null {
  if (!diff.trim()) return null;

  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  const hunks: ParsedDiffHunk[] = [];
  let currentHunk: ParsedDiffHunk | null = null;
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let oldLineCursor = 0;
  let newLineCursor = 0;

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      oldPath = normalizeDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith('+++ ')) {
      newPath = normalizeDiffPath(line.slice(4));
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@(.*)$/);
    if (hunkMatch) {
      const oldRange = parseRange(hunkMatch[1] ?? '0');
      const newRange = parseRange(hunkMatch[2] ?? '0');
      currentHunk = {
        header: line,
        id: `${hunks.length}-${line}`,
        lines: [],
        newLines: newRange.count,
        newStart: newRange.start,
        oldLines: oldRange.count,
        oldStart: oldRange.start
      };
      oldLineCursor = oldRange.start;
      newLineCursor = newRange.start;
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;
    if (line.startsWith('\\')) continue;

    const prefix = line[0];
    const content = line.slice(1);
    if (prefix === '+') {
      currentHunk.lines.push({
        content,
        key: `${currentHunk.id}-add-${currentHunk.lines.length}`,
        kind: 'add',
        newLineNumber: newLineCursor,
        oldLineNumber: null
      });
      newLineCursor += 1;
      continue;
    }
    if (prefix === '-') {
      currentHunk.lines.push({
        content,
        key: `${currentHunk.id}-del-${currentHunk.lines.length}`,
        kind: 'del',
        newLineNumber: null,
        oldLineNumber: oldLineCursor
      });
      oldLineCursor += 1;
      continue;
    }
    if (prefix !== ' ') continue;

    currentHunk.lines.push({
      content,
      key: `${currentHunk.id}-ctx-${currentHunk.lines.length}`,
      kind: 'context',
      newLineNumber: newLineCursor,
      oldLineNumber: oldLineCursor
    });
    oldLineCursor += 1;
    newLineCursor += 1;
  }

  return {
    newPath,
    oldPath,
    raw: diff,
    hunks
  };
}
