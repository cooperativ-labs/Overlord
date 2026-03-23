import type {
  EnrichedCurrentChangeFile,
  FileChangeRecord,
  GitStatusFile,
  TicketSummary
} from './types';

function compareNewestFirst(
  left: Pick<FileChangeRecord, 'created_at'>,
  right: Pick<FileChangeRecord, 'created_at'>
) {
  if ('is_draft' in left && 'is_draft' in right && left.is_draft !== right.is_draft) {
    return left.is_draft ? 1 : -1;
  }
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

export function buildEnrichedCurrentChangeFiles(args: {
  files: GitStatusFile[];
  rationales: FileChangeRecord[];
}): EnrichedCurrentChangeFile[] {
  const { files, rationales } = args;

  return files.map(file => {
    const paths = new Set(candidatePaths(file));
    const relatedRationales = rationales
      .filter(rationale => paths.has(rationale.file_path))
      .sort(compareNewestFirst);
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
