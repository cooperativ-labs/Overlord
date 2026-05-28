import type { GraphApiResponse, GraphFileChangeRecord } from '../types';

function sanitizeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60);
}

function escapeLabel(input: string): string {
  return input.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 80);
}

/**
 * Builds a Mermaid flowchart describing the compare set: tickets on the left,
 * files on the right, edges colored by change_kind. Suitable for pasting in a
 * PR comment or markdown doc.
 */
export function buildMermaidExport(data: GraphApiResponse): string {
  if (data.fileChanges.length === 0) {
    return '```mermaid\nflowchart LR\n  %% No file changes in compare set\n```';
  }

  const lines: string[] = ['flowchart LR'];

  const tickets = new Map<string, { shortId: string; title: string }>();
  for (const fc of data.fileChanges) {
    if (fc.ticket && !tickets.has(fc.ticket_id)) {
      tickets.set(fc.ticket_id, { shortId: fc.ticket.ticket_id, title: fc.ticket.title });
    }
  }

  for (const [ticketId, t] of tickets) {
    const id = `T_${sanitizeId(ticketId)}`;
    lines.push(`  ${id}["${escapeLabel(t.shortId + ' · ' + t.title)}"]:::ticket`);
  }

  const files = new Map<string, string>();
  for (const fc of data.fileChanges) {
    if (!files.has(fc.file_path)) {
      const id = `F_${sanitizeId(fc.file_path)}`;
      files.set(fc.file_path, id);
      lines.push(`  ${id}["${escapeLabel(fc.file_path)}"]:::file`);
    }
  }

  const seenEdges = new Set<string>();
  const groupedByKind: Record<string, GraphFileChangeRecord[]> = {};
  for (const fc of data.fileChanges) {
    const key = `${fc.ticket_id}->${fc.file_path}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    const tId = `T_${sanitizeId(fc.ticket_id)}`;
    const fId = files.get(fc.file_path)!;
    const arrow = fc.change_kind === 'delete' ? '-.->' : '-->';
    lines.push(`  ${tId} ${arrow}|"${escapeLabel(fc.label)}"| ${fId}`);
    (groupedByKind[fc.change_kind] ||= []).push(fc);
  }

  lines.push('  classDef ticket fill:#1e293b,stroke:#3b82f6,color:#f1f5f9;');
  lines.push('  classDef file fill:#0f172a,stroke:#64748b,color:#e2e8f0;');

  return '```mermaid\n' + lines.join('\n') + '\n```';
}
