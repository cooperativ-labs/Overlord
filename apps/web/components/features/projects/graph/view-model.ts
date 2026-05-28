import type { Edge, Node } from '@xyflow/react';

import type {
  CoChangeEdgeData,
  GraphApiResponse,
  GraphFileChangeRecord,
  GraphFilters,
  HotspotRecord,
  RationaleEdgeData
} from './types';
import { CHANGE_KIND_COLORS, hasActiveFilters, IMPACT_STROKE_WIDTH } from './types';

const DIRECTORY_HUES = [
  '#6366f1',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#8b5cf6',
  '#06b6d4',
  '#84cc16',
  '#e11d48',
  '#0ea5e9',
  '#eab308'
];

function directoryColor(dir: string): string {
  let hash = 0;
  for (let i = 0; i < dir.length; i++) {
    hash = (hash * 31 + dir.charCodeAt(i)) | 0;
  }
  return DIRECTORY_HUES[Math.abs(hash) % DIRECTORY_HUES.length];
}

export function topDirectory(filePath: string): string {
  const parts = filePath.split('/');
  return parts.length > 1 ? parts[0] : '(root)';
}

export const LARGE_GRAPH_NODE_THRESHOLD = 500;
export const LARGE_GRAPH_EDGE_THRESHOLD = 2000;

export interface GraphViewModel {
  nodes: Node[];
  edges: Edge[];
  ticketNodes: Map<string, Node>;
  fileNodes: Map<string, Node>;
  coChangeEdges: Edge[];
  allDirectories: string[];
  allChangeKinds: string[];
  allImpacts: string[];
  allStatusTypes: string[];
  fileToTickets: Map<string, Set<string>>;
  /** Earliest and latest file_change created_at across the dataset (pre-filter). */
  timeBounds: { min: string; max: string } | null;
  /** True when node+edge counts exceed performance thresholds. */
  isLargeGraph: boolean;
  /** If aggregation was applied, how many files were collapsed into directory super-nodes. */
  aggregatedFileCount: number;
}

export function buildGraphViewModel(
  data: GraphApiResponse,
  filters?: GraphFilters
): GraphViewModel {
  const ticketMap = new Map<
    string,
    { ticket: NonNullable<GraphFileChangeRecord['ticket']>; filePaths: Set<string> }
  >();
  const fileMap = new Map<
    string,
    {
      filePath: string;
      fileName: string;
      ticketIds: Set<string>;
      changeKinds: Set<string>;
      impacts: Set<string>;
    }
  >();
  const rationaleEdges: Edge[] = [];
  const seenEdgeKeys = new Set<string>();
  const fileToTickets = new Map<string, Set<string>>();

  const allDirectories = new Set<string>();
  const allChangeKinds = new Set<string>();
  const allImpacts = new Set<string>();
  const allStatusTypes = new Set<string>();

  // Compute time bounds from the full dataset so the scrubber range is stable.
  let timeBoundsMin: string | null = null;
  let timeBoundsMax: string | null = null;
  for (const fc of data.fileChanges) {
    if (!timeBoundsMin || fc.created_at < timeBoundsMin) timeBoundsMin = fc.created_at;
    if (!timeBoundsMax || fc.created_at > timeBoundsMax) timeBoundsMax = fc.created_at;
  }

  const maxTime = filters?.maxTime ?? null;
  const visibleFileChanges = maxTime
    ? data.fileChanges.filter(fc => fc.created_at <= maxTime)
    : data.fileChanges;

  for (const ticket of data.tickets) {
    if (!ticketMap.has(ticket.id)) {
      ticketMap.set(ticket.id, { ticket, filePaths: new Set() });
    }
    if (ticket.status_type) allStatusTypes.add(ticket.status_type);
  }

  for (const fc of visibleFileChanges) {
    if (fc.ticket && !ticketMap.has(fc.ticket.id)) {
      ticketMap.set(fc.ticket.id, { ticket: fc.ticket, filePaths: new Set() });
      if (fc.ticket.status_type) allStatusTypes.add(fc.ticket.status_type);
    }
    if (fc.ticket) {
      ticketMap.get(fc.ticket.id)!.filePaths.add(fc.file_path);
    }

    const dir = topDirectory(fc.file_path);
    allDirectories.add(dir);
    allChangeKinds.add(fc.change_kind);
    allImpacts.add(fc.impact);

    if (!fileMap.has(fc.file_path)) {
      fileMap.set(fc.file_path, {
        filePath: fc.file_path,
        fileName: fc.file_name,
        ticketIds: new Set(),
        changeKinds: new Set(),
        impacts: new Set()
      });
    }
    const fileEntry = fileMap.get(fc.file_path)!;
    fileEntry.ticketIds.add(fc.ticket_id);
    fileEntry.changeKinds.add(fc.change_kind);
    fileEntry.impacts.add(fc.impact);

    if (!fileToTickets.has(fc.file_path)) {
      fileToTickets.set(fc.file_path, new Set());
    }
    fileToTickets.get(fc.file_path)!.add(fc.ticket_id);

    const edgeKey = `${fc.ticket_id}->${fc.file_path}`;
    if (!seenEdgeKeys.has(edgeKey)) {
      seenEdgeKeys.add(edgeKey);
      const edgeData: RationaleEdgeData = {
        fileChangeId: fc.id,
        label: fc.label,
        summary: fc.summary,
        why: fc.why,
        impact: fc.impact,
        changeKind: fc.change_kind,
        confidence: fc.confidence
      };
      rationaleEdges.push({
        id: `edge-${fc.ticket_id}-${fc.file_path}`,
        source: `ticket-${fc.ticket_id}`,
        target: `file-${fc.file_path}`,
        type: 'rationale',
        data: edgeData as unknown as Record<string, unknown>,
        style: {
          stroke: CHANGE_KIND_COLORS[fc.change_kind] ?? '#64748b',
          strokeWidth: IMPACT_STROKE_WIDTH[fc.impact] ?? 1
        }
      });
    }
  }

  // Derive co-change edges between tickets sharing files
  const coChangeEdges: Edge[] = [];
  const coChangeSeen = new Set<string>();
  for (const ticketIdSet of fileToTickets.values()) {
    const ticketIds = [...ticketIdSet];
    for (let i = 0; i < ticketIds.length; i++) {
      for (let j = i + 1; j < ticketIds.length; j++) {
        const [a, b] =
          ticketIds[i] < ticketIds[j] ? [ticketIds[i], ticketIds[j]] : [ticketIds[j], ticketIds[i]];
        const key = `${a}<->${b}`;
        if (!coChangeSeen.has(key)) {
          coChangeSeen.add(key);
          const sharedFiles: string[] = [];
          for (const [fp, tids] of fileToTickets) {
            if (tids.has(a) && tids.has(b)) sharedFiles.push(fp);
          }
          const edgeData: CoChangeEdgeData = {
            type: 'co-change',
            sharedFiles,
            sharedFileCount: sharedFiles.length
          };
          coChangeEdges.push({
            id: `cochange-${a}-${b}`,
            source: `ticket-${a}`,
            target: `ticket-${b}`,
            type: 'cochange',
            data: edgeData as unknown as Record<string, unknown>,
            style: {
              stroke: '#f59e0b',
              strokeWidth: Math.min(sharedFiles.length, 4),
              strokeDasharray: '6 3'
            }
          });
        }
      }
    }
  }

  const active = filters && hasActiveFilters(filters);

  const ticketNodes = new Map<string, Node>();
  let ticketIndex = 0;
  for (const [id, entry] of ticketMap) {
    const dimmed =
      active &&
      filters!.statusTypes.size > 0 &&
      entry.ticket.status_type !== null &&
      !filters!.statusTypes.has(entry.ticket.status_type);

    ticketNodes.set(id, {
      id: `ticket-${id}`,
      type: 'ticket',
      position: { x: 0, y: ticketIndex * 150 },
      data: {
        type: 'ticket',
        ticketId: entry.ticket.ticket_id,
        shortId: entry.ticket.ticket_id,
        title: entry.ticket.title,
        status: entry.ticket.status,
        statusType: entry.ticket.status_type,
        fileCount: entry.filePaths.size,
        dimmed: !!dimmed
      }
    });
    ticketIndex++;
  }

  const fileNodes = new Map<string, Node>();
  let fileIndex = 0;
  for (const [filePath, entry] of fileMap) {
    const dir = topDirectory(filePath);
    const dimmed =
      active &&
      ((filters!.directories.size > 0 && !filters!.directories.has(dir)) ||
        (filters!.changeKinds.size > 0 &&
          ![...entry.changeKinds].some(k => filters!.changeKinds.has(k))) ||
        (filters!.impacts.size > 0 && ![...entry.impacts].some(i => filters!.impacts.has(i))));

    fileNodes.set(filePath, {
      id: `file-${filePath}`,
      type: 'file',
      position: { x: 400, y: fileIndex * 80 },
      data: {
        type: 'file',
        filePath: entry.filePath,
        fileName: entry.fileName,
        directory: dir,
        ticketCount: entry.ticketIds.size,
        changeKinds: [...entry.changeKinds],
        impacts: [...entry.impacts],
        dimmed: !!dimmed
      },
      style: {
        borderColor: directoryColor(dir)
      }
    });
    fileIndex++;
  }

  const nodes: Node[] = [...ticketNodes.values(), ...fileNodes.values()];
  const edges: Edge[] = [...rationaleEdges, ...coChangeEdges];

  const totalNodes = nodes.length;
  const totalEdges = edges.length;

  return {
    nodes,
    edges,
    ticketNodes,
    fileNodes,
    coChangeEdges,
    allDirectories: [...allDirectories].sort(),
    allChangeKinds: [...allChangeKinds].sort(),
    allImpacts: [...allImpacts],
    allStatusTypes: [...allStatusTypes].sort(),
    fileToTickets,
    timeBounds: timeBoundsMin && timeBoundsMax ? { min: timeBoundsMin, max: timeBoundsMax } : null,
    isLargeGraph:
      totalNodes > LARGE_GRAPH_NODE_THRESHOLD || totalEdges > LARGE_GRAPH_EDGE_THRESHOLD,
    aggregatedFileCount: 0
  };
}

export interface HotspotViewModel {
  nodes: Node[];
  edges: Edge[];
  hotspots: HotspotRecord[];
  windowDays: number;
}

const HOTSPOT_HEAT_RAMP = [
  '#fde68a',
  '#fcd34d',
  '#fbbf24',
  '#f59e0b',
  '#ea580c',
  '#dc2626',
  '#991b1b'
];

function heatColor(score: number, maxScore: number): string {
  if (maxScore <= 0) return HOTSPOT_HEAT_RAMP[0];
  const t = Math.min(score / maxScore, 1);
  const idx = Math.min(Math.floor(t * HOTSPOT_HEAT_RAMP.length), HOTSPOT_HEAT_RAMP.length - 1);
  return HOTSPOT_HEAT_RAMP[idx];
}

export function buildHotspotViewModel(
  hotspots: HotspotRecord[],
  windowDays: number
): HotspotViewModel {
  if (hotspots.length === 0) {
    return { nodes: [], edges: [], hotspots, windowDays };
  }

  const maxScore = hotspots.reduce((m, h) => Math.max(m, h.impact_score), 0);
  const maxTicketCount = hotspots.reduce((m, h) => Math.max(m, h.ticket_count), 1);

  const byDir = new Map<string, HotspotRecord[]>();
  for (const h of hotspots) {
    const dir = topDirectory(h.file_path);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(h);
  }

  const sortedDirs = [...byDir.keys()].sort();
  const colWidth = 240;
  const rowHeight = 56;

  const nodes: Node[] = [];
  sortedDirs.forEach((dir, dirIdx) => {
    const records = byDir.get(dir)!;
    records.sort((a, b) => b.impact_score - a.impact_score);
    records.forEach((h, rowIdx) => {
      const size = 1 + (h.ticket_count / maxTicketCount) * 1.5;
      nodes.push({
        id: `hotspot-${h.file_path}`,
        type: 'hotspot',
        position: { x: dirIdx * colWidth, y: rowIdx * rowHeight },
        data: {
          type: 'hotspot',
          filePath: h.file_path,
          fileName: h.file_name,
          directory: dir,
          ticketCount: h.ticket_count,
          rationaleCount: h.rationale_count,
          impactScore: h.impact_score,
          lastActivity: h.last_activity,
          heatColor: heatColor(h.impact_score, maxScore),
          sizeMultiplier: size
        }
      });
    });
  });

  return { nodes, edges: [], hotspots, windowDays };
}

export interface DiffLanesLayout {
  positions: Map<string, { x: number; y: number }>;
  shared: string[];
  onlyA: string[];
  onlyB: string[];
}

export function buildDiffLanesLayout(
  viewModel: GraphViewModel,
  ticketAId: string,
  ticketBId: string
): DiffLanesLayout | null {
  const aFiles = new Set<string>();
  const bFiles = new Set<string>();
  for (const [filePath, ticketIds] of viewModel.fileToTickets) {
    if (ticketIds.has(ticketAId)) aFiles.add(filePath);
    if (ticketIds.has(ticketBId)) bFiles.add(filePath);
  }

  const shared: string[] = [];
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const fp of aFiles) {
    if (bFiles.has(fp)) shared.push(fp);
    else onlyA.push(fp);
  }
  for (const fp of bFiles) {
    if (!aFiles.has(fp)) onlyB.push(fp);
  }

  shared.sort();
  onlyA.sort();
  onlyB.sort();

  const positions = new Map<string, { x: number; y: number }>();
  const rowHeight = 70;
  const onlyAX = 0;
  const sharedX = 400;
  const onlyBX = 800;
  const ticketAX = -260;
  const ticketBX = 1060;
  const verticalCenter = (Math.max(shared.length, onlyA.length, onlyB.length) * rowHeight) / 2;

  positions.set(`ticket-${ticketAId}`, { x: ticketAX, y: verticalCenter });
  positions.set(`ticket-${ticketBId}`, { x: ticketBX, y: verticalCenter });

  onlyA.forEach((fp, i) => positions.set(`file-${fp}`, { x: onlyAX, y: i * rowHeight }));
  shared.forEach((fp, i) => positions.set(`file-${fp}`, { x: sharedX, y: i * rowHeight }));
  onlyB.forEach((fp, i) => positions.set(`file-${fp}`, { x: onlyBX, y: i * rowHeight }));

  return { positions, shared, onlyA, onlyB };
}

export function aggregateToDirectories(viewModel: GraphViewModel): GraphViewModel {
  const dirNodes = new Map<
    string,
    { ticketIds: Set<string>; fileCount: number; changeKinds: Set<string>; impacts: Set<string> }
  >();
  let aggregatedCount = 0;

  for (const [filePath, node] of viewModel.fileNodes) {
    const d = node.data as { directory: string; changeKinds: string[]; impacts: string[] };
    const dir = d.directory;
    if (!dirNodes.has(dir)) {
      dirNodes.set(dir, {
        ticketIds: new Set(),
        fileCount: 0,
        changeKinds: new Set(),
        impacts: new Set()
      });
    }
    const entry = dirNodes.get(dir)!;
    entry.fileCount++;
    aggregatedCount++;
    const ticketIds = viewModel.fileToTickets.get(filePath);
    if (ticketIds) ticketIds.forEach(t => entry.ticketIds.add(t));
    d.changeKinds.forEach(k => entry.changeKinds.add(k));
    d.impacts.forEach(i => entry.impacts.add(i));
  }

  const newFileNodes = new Map<string, Node>();
  const newNodes: Node[] = [...viewModel.ticketNodes.values()];
  let dirIdx = 0;
  for (const [dir, entry] of dirNodes) {
    const node: Node = {
      id: `dir-${dir}`,
      type: 'file',
      position: { x: 400, y: dirIdx * 80 },
      data: {
        type: 'file',
        filePath: `${dir}/`,
        fileName: `${dir}/ (${entry.fileCount} files)`,
        directory: dir,
        ticketCount: entry.ticketIds.size,
        changeKinds: [...entry.changeKinds],
        impacts: [...entry.impacts],
        dimmed: false
      }
    };
    newFileNodes.set(dir, node);
    newNodes.push(node);
    dirIdx++;
  }

  const seenEdges = new Set<string>();
  const newEdges: Edge[] = [];
  for (const edge of viewModel.edges) {
    if (edge.type === 'cochange') {
      newEdges.push(edge);
      continue;
    }
    const filePath = edge.target.replace('file-', '');
    const dir = topDirectory(filePath);
    const edgeKey = `${edge.source}->dir-${dir}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    newEdges.push({
      ...edge,
      id: edgeKey,
      target: `dir-${dir}`
    });
  }

  return {
    ...viewModel,
    nodes: newNodes,
    edges: newEdges,
    fileNodes: newFileNodes,
    isLargeGraph: true,
    aggregatedFileCount: aggregatedCount
  };
}

export function getOneHopTicketIds(
  fileToTickets: Map<string, Set<string>>,
  filePath: string,
  excludeTicketIds: Set<string>
): string[] {
  const ticketIds = fileToTickets.get(filePath);
  if (!ticketIds) return [];
  return [...ticketIds].filter(id => !excludeTicketIds.has(id));
}
