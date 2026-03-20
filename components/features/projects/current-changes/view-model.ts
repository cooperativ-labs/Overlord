import type {
  ChangeRationaleRecord,
  EnrichedCurrentChangeFile,
  FileAttribution,
  GitStatusFile,
  TicketSummary
} from './types';

function compareNewestFirst(
  left: Pick<ChangeRationaleRecord, 'created_at'>,
  right: Pick<ChangeRationaleRecord, 'created_at'>
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

function uniqueTickets(
  relatedRationales: ChangeRationaleRecord[],
  relatedAttributions: FileAttribution[]
): TicketSummary[] {
  const ticketMap = new Map<string, TicketSummary>();

  for (const rationale of relatedRationales) {
    if (rationale.ticket && !ticketMap.has(rationale.ticket.id)) {
      ticketMap.set(rationale.ticket.id, rationale.ticket);
    }
  }

  for (const attribution of relatedAttributions) {
    if (!ticketMap.has(attribution.ticket_id)) {
      ticketMap.set(attribution.ticket_id, {
        id: attribution.ticket_id,
        objective: null,
        recent_agent: null,
        status: null,
        title: attribution.ticket_title
      });
    }
  }

  return [...ticketMap.values()];
}

export function buildEnrichedCurrentChangeFiles(args: {
  fileAttributions: FileAttribution[];
  files: GitStatusFile[];
  rationales: ChangeRationaleRecord[];
}): EnrichedCurrentChangeFile[] {
  const { fileAttributions, files, rationales } = args;

  return files.map(file => {
    const paths = new Set(candidatePaths(file));
    const relatedRationales = rationales
      .filter(rationale => paths.has(rationale.file_path))
      .sort(compareNewestFirst);
    const relatedAttributions = fileAttributions.filter(attribution =>
      paths.has(attribution.file_path)
    );
    const tickets = uniqueTickets(relatedRationales, relatedAttributions);
    const primaryRationale = relatedRationales[0] ?? null;
    const primaryTicket =
      primaryRationale?.ticket ??
      (relatedAttributions[0]
        ? (tickets.find(ticket => ticket.id === relatedAttributions[0]?.ticket_id) ?? null)
        : (tickets[0] ?? null));

    return {
      attributionCount: relatedAttributions.length,
      file,
      path: file.path,
      primaryRationale,
      primaryTicket,
      rationaleCount: relatedRationales.length,
      rationales: relatedRationales,
      summary: primaryRationale?.summary?.trim() || fallbackSummary(file),
      tickets
    };
  });
}
