import { rationaleIntersectsParsedDiff } from './helpers';
import type {
  EnrichedCurrentChangeFile,
  FileChangeRecord,
  GitDiffFilterEntry,
  GitStatusFile,
  TicketSummary
} from './types';

function compareNewestFirst(
  left: Pick<FileChangeRecord, 'created_at'>,
  right: Pick<FileChangeRecord, 'created_at'>
) {
  return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
}

function candidatePaths(file: Pick<GitStatusFile, 'originalPath' | 'path'>): string[] {
  return [file.path, file.originalPath].filter((value): value is string => Boolean(value));
}

function fallbackSummary(file: GitStatusFile): string {
  switch (file.status) {
    case 'added':
      return 'New file awaiting linked rationale.';
    case 'deleted':
      return 'Deleted file awaiting linked rationale.';
    case 'renamed':
      return 'Renamed file awaiting linked rationale.';
    case 'copied':
      return 'Copied file awaiting linked rationale.';
    case 'untracked':
      return 'Untracked file with no linked rationale yet.';
    default:
      return 'Modified file with no linked rationale yet.';
  }
}

function uniqueTickets(relatedRationales: FileChangeRecord[]): TicketSummary[] {
  const ticketMap = new Map<string, TicketSummary>();

  for (const rationale of relatedRationales) {
    if (rationale.ticket && !ticketMap.has(rationale.ticket.id)) {
      ticketMap.set(rationale.ticket.id, rationale.ticket);
    }
  }

  return [...ticketMap.values()];
}

function resolveGitDiffEntry(
  file: GitStatusFile,
  gitDiffFilterByPath: Map<string, GitDiffFilterEntry> | undefined
): GitDiffFilterEntry | null {
  if (!gitDiffFilterByPath) return null;
  const byPath = gitDiffFilterByPath.get(file.path);
  if (byPath) return byPath;
  if (file.originalPath) return gitDiffFilterByPath.get(file.originalPath) ?? null;
  return null;
}

export function buildEnrichedCurrentChangeFiles(args: {
  files: GitStatusFile[];
  gitDiffFilterByPath?: Map<string, GitDiffFilterEntry>;
  rationales: FileChangeRecord[];
}): EnrichedCurrentChangeFile[] {
  const { files, gitDiffFilterByPath, rationales } = args;

  return files.map(file => {
    const paths = new Set(candidatePaths(file));
    let relatedRationales = rationales
      .filter(rationale => paths.has(rationale.file_path) && Boolean(rationale.ticket))
      .sort(compareNewestFirst);

    const diffEntry = resolveGitDiffEntry(file, gitDiffFilterByPath);
    if (gitDiffFilterByPath && gitDiffFilterByPath.size > 0) {
      if (!diffEntry || diffEntry.kind === 'pending') {
        relatedRationales = [];
      } else if (diffEntry.kind === 'ready') {
        relatedRationales = relatedRationales.filter(rationale =>
          rationaleIntersectsParsedDiff(rationale, diffEntry.parsed)
        );
      }
    }
    const tickets = uniqueTickets(relatedRationales);
    const primaryFileChange = relatedRationales[0] ?? null;
    const primaryTicket = primaryFileChange?.ticket ?? tickets[0] ?? null;

    return {
      fileChangeCount: relatedRationales.length,
      file,
      path: file.path,
      primaryFileChange,
      primaryTicket,
      rationales: relatedRationales,
      summary: primaryFileChange?.summary?.trim() || fallbackSummary(file),
      tickets
    };
  });
}

export function countFilesPerTicket(
  enrichedFiles: EnrichedCurrentChangeFile[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const enriched of enrichedFiles) {
    const seenForFile = new Set<string>();
    for (const ticket of enriched.tickets) {
      if (seenForFile.has(ticket.id)) continue;
      seenForFile.add(ticket.id);
      counts.set(ticket.id, (counts.get(ticket.id) ?? 0) + 1);
    }
  }
  return counts;
}

export function ticketIdsTouchingCurrentChanges(
  enrichedFiles: EnrichedCurrentChangeFile[]
): Set<string> {
  const ids = new Set<string>();
  for (const file of enrichedFiles) {
    for (const ticket of file.tickets) {
      ids.add(ticket.id);
    }
  }
  return ids;
}

export function ticketFilterSelectionsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  if (left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
}

export function pruneTicketFilterSelection(args: {
  selectedTicketIds: ReadonlySet<string>;
  validTicketIds: ReadonlySet<string>;
}): Set<string> {
  const next = new Set<string>();
  for (const id of args.selectedTicketIds) {
    if (args.validTicketIds.has(id)) {
      next.add(id);
    }
  }
  return next;
}
