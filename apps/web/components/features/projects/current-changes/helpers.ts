import type { ParsedDiffHunk, ParsedUnifiedDiff } from '@/lib/git/unified-diff';
import type { Json } from '@/types/database.types';

import type { FileChangeRecord, GitStatusFile, RationaleHunk } from './types';

function normalizeRoot(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '');
}

export function normalizeCurrentChangePath(
  value: string | null | undefined,
  roots: Array<string | null | undefined> = []
): string | null {
  if (!value) return null;

  let normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) return null;

  normalized = normalized.replace(/^file:\/\//, '');

  for (const root of roots) {
    if (!root) continue;
    const normalizedRoot = normalizeRoot(root);
    if (!normalizedRoot) continue;
    if (normalized === normalizedRoot) return '';
    if (normalized.startsWith(`${normalizedRoot}/`)) {
      normalized = normalized.slice(normalizedRoot.length + 1);
      break;
    }
  }

  normalized = normalized.replace(/^\.\/+/, '');
  normalized = normalized.replace(/\/{2,}/g, '/');
  return normalized || null;
}

export function buildCurrentChangePathVariants(
  value: string,
  roots: Array<string | null | undefined> = []
): string[] {
  const variants = new Set<string>();
  const normalized = normalizeCurrentChangePath(value, roots);
  const raw = value.replace(/\\/g, '/').trim();

  if (raw) variants.add(raw);
  if (normalized) {
    variants.add(normalized);
    variants.add(`./${normalized}`);
    for (const root of roots) {
      if (!root) continue;
      const normalizedRoot = normalizeRoot(root);
      if (normalizedRoot) variants.add(`${normalizedRoot}/${normalized}`);
    }
  }

  return [...variants].filter(Boolean);
}

export function formatStatus(status: string): string {
  switch (status) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'typechange':
      return 'Type';
    case 'untracked':
      return 'Untracked';
    default:
      return 'Modified';
  }
}

export function getStatusInitial(status: string): string {
  switch (status) {
    case 'added':
      return 'a';
    case 'deleted':
      return 'd';
    case 'renamed':
      return 'r';
    case 'copied':
      return 'c';
    case 'typechange':
      return 't';
    case 'untracked':
      return 'u';
    default:
      return 'm';
  }
}

export function getStatusTooltipLabel(status: string): string {
  return formatStatus(status);
}

export function getStatusClasses(status: string): string {
  switch (status) {
    case 'added':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    case 'deleted':
      return 'bg-rose-500/10 text-rose-700 border-rose-500/20';
    case 'renamed':
      return 'bg-sky-500/10 text-sky-700 border-sky-500/20';
    case 'untracked':
      return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function lineNumber(value: number | null): string {
  return value === null ? '' : String(value);
}

export function getRationalePaths(files: GitStatusFile[]): string[] {
  return [
    ...new Set(
      files.flatMap(file =>
        [file.path, file.originalPath].filter((value): value is string => Boolean(value))
      )
    )
  ];
}

function parseRationaleHunks(value: Json): RationaleHunk[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, Json>;

    return [
      {
        header: typeof candidate.header === 'string' ? candidate.header : undefined,
        new_lines: typeof candidate.new_lines === 'number' ? candidate.new_lines : undefined,
        new_start: typeof candidate.new_start === 'number' ? candidate.new_start : undefined,
        old_lines: typeof candidate.old_lines === 'number' ? candidate.old_lines : undefined,
        old_start: typeof candidate.old_start === 'number' ? candidate.old_start : undefined
      }
    ];
  });
}

function rangesOverlap(
  startA: number | undefined,
  lengthA: number | undefined,
  startB: number,
  lengthB: number
): boolean {
  if (typeof startA !== 'number') return false;
  const aEnd = startA + Math.max((lengthA ?? 1) - 1, 0);
  const bEnd = startB + Math.max(lengthB - 1, 0);
  return startA <= bEnd && startB <= aEnd;
}

function hunkMatchesRationale(hunk: ParsedDiffHunk, rationale: FileChangeRecord): boolean {
  const rationaleHunks = parseRationaleHunks(rationale.hunks);
  if (rationaleHunks.length === 0) return false;

  return rationaleHunks.some(candidate => {
    if (candidate.header && candidate.header === hunk.header) return true;
    if (rangesOverlap(candidate.new_start, candidate.new_lines, hunk.newStart, hunk.newLines)) {
      return true;
    }
    return rangesOverlap(candidate.old_start, candidate.old_lines, hunk.oldStart, hunk.oldLines);
  });
}

/** True when stored rationale hunks overlap any hunk in the current working-tree unified diff. */
export function rationaleIntersectsParsedDiff(
  rationale: FileChangeRecord,
  parsed: ParsedUnifiedDiff | null
): boolean {
  if (!parsed?.hunks.length) return false;
  for (const hunk of parsed.hunks) {
    if (hunkMatchesRationale(hunk, rationale)) return true;
  }
  return false;
}

export function buildHunkMatches(
  rationales: FileChangeRecord[],
  file: GitStatusFile,
  hunk: ParsedDiffHunk
): FileChangeRecord[] {
  void file;
  return rationales.filter(rationale => hunkMatchesRationale(hunk, rationale));
}

export function countFileRationales(file: GitStatusFile, rationales: FileChangeRecord[]): number {
  const candidatePaths = new Set(
    [file.path, file.originalPath]
      .map(value => normalizeCurrentChangePath(value))
      .filter((value): value is string => Boolean(value))
  );
  return rationales.filter(rationale =>
    candidatePaths.has(normalizeCurrentChangePath(rationale.file_path) ?? '')
  ).length;
}
