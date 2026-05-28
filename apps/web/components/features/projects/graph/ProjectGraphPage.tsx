'use client';

import * as Sentry from '@sentry/nextjs';
import { ReactFlowProvider } from '@xyflow/react';
import { AlertTriangle, Loader2, Network } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ErrorBoundary } from '@/components/ui/error-boundary';
import { useGraphViewModel, useProjectGraphQuery } from '@/lib/client-data/project-graph/hooks';

import { ExportGraphMenu } from './ExportGraphMenu';
import { GraphCanvas } from './GraphCanvas';
import type { SelectionTarget } from './GraphDetailsPanel';
import { GraphDetailsPanel } from './GraphDetailsPanel';
import { GraphFiltersBar } from './GraphFiltersBar';
import { GraphHelpDialog } from './GraphHelpDialog';
import { GraphHotspotView } from './GraphHotspotView';
import { GraphMobileList } from './GraphMobileList';
import { GraphModeSwitcher } from './GraphModeSwitcher';
import { GraphSearchTray } from './GraphSearchTray';
import { GraphTimeScrubber } from './GraphTimeScrubber';
import type { GraphFilters, GraphMode } from './types';
import { emptyFilters } from './types';
import { filtersFromPrefs, useGraphPreferences } from './useGraphPreferences';
import { useGraphRealtime } from './useGraphRealtime';
import {
  aggregateToDirectories,
  buildDiffLanesLayout,
  getOneHopTicketIds,
  LARGE_GRAPH_NODE_THRESHOLD
} from './view-model';

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

interface ProjectGraphPageProps {
  projectId: string;
  projectName: string;
}

export function ProjectGraphPage({ projectId, projectName: _projectName }: ProjectGraphPageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMobile = useIsMobile();

  const ticketIds = useMemo(() => {
    const compare = searchParams.get('compare') ?? '';
    return compare
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }, [searchParams]);

  const { prefs, hydrated, setMode, setHotspotWindowDays, setFiltersPref } =
    useGraphPreferences(projectId);

  const [filters, setFilters] = useState<GraphFilters>(() => emptyFilters());
  const [selection, setSelection] = useState<SelectionTarget>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [aggregated, setAggregated] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    setFilters(filtersFromPrefs(prefs.filters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const mode: GraphMode = prefs.mode;

  const {
    viewModel: rawViewModel,
    isLoading,
    error
  } = useGraphViewModel({
    projectId,
    ticketIds,
    enabled: ticketIds.length > 0,
    filters
  });

  const graphQuery = useProjectGraphQuery({
    projectId,
    ticketIds,
    enabled: ticketIds.length > 0
  });

  useGraphRealtime({ projectId, ticketIds, enabled: ticketIds.length > 0 });

  useEffect(() => {
    if (!rawViewModel || aggregated) return;
    if (rawViewModel.isLargeGraph) {
      setAggregated(true);
    }
  }, [rawViewModel, aggregated]);

  // Auto-aggregate large graphs or respect manual toggle
  const viewModel = useMemo(() => {
    if (!rawViewModel) return null;
    if (aggregated && rawViewModel.fileNodes.size > LARGE_GRAPH_NODE_THRESHOLD) {
      return aggregateToDirectories(rawViewModel);
    }
    return rawViewModel;
  }, [rawViewModel, aggregated]);

  // Report graph API errors to Sentry
  useEffect(() => {
    if (error) {
      Sentry.captureException(error, {
        tags: { feature: 'project-graph', projectId },
        extra: { ticketCount: ticketIds.length }
      });
    }
  }, [error, projectId, ticketIds.length]);

  const updateCompareSet = useCallback(
    (next: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.length > 0) {
        params.set('compare', next.join(','));
      } else {
        params.delete('compare');
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  const addTicket = useCallback(
    (ticketId: string) => {
      if (!ticketIds.includes(ticketId)) {
        updateCompareSet([...ticketIds, ticketId]);
      }
    },
    [ticketIds, updateCompareSet]
  );

  const removeTicket = useCallback(
    (ticketId: string) => {
      updateCompareSet(ticketIds.filter(id => id !== ticketId));
    },
    [ticketIds, updateCompareSet]
  );

  const handleSelectionChange = useCallback((sel: SelectionTarget) => {
    setSelection(sel);
    if (sel?.kind === 'node') {
      setFocusedNodeId(sel.node.id);
    } else {
      setFocusedNodeId(null);
    }
  }, []);

  const handleExpandFile = useCallback(
    (filePath: string) => {
      if (!viewModel) return;
      const currentSet = new Set(ticketIds);
      const newTicketIds = getOneHopTicketIds(viewModel.fileToTickets, filePath, currentSet);
      if (newTicketIds.length > 0) {
        updateCompareSet([...ticketIds, ...newTicketIds]);
      }
    },
    [viewModel, ticketIds, updateCompareSet]
  );

  const handleCloseDetails = useCallback(() => {
    setSelection(null);
    setFocusedNodeId(null);
  }, []);

  const handleFiltersChange = useCallback(
    (next: GraphFilters) => {
      setFilters(next);
      setFiltersPref(next);
    },
    [setFiltersPref]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseDetails();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCloseDetails]);

  const ticketLabels = useMemo(() => {
    if (!viewModel) return new Map();
    const labels = new Map<string, { shortId: string; title: string; statusType: string | null }>();
    for (const [id, node] of viewModel.ticketNodes) {
      const d = node.data as { shortId: string; title: string; statusType: string | null };
      labels.set(id, { shortId: d.shortId, title: d.title, statusType: d.statusType });
    }
    return labels;
  }, [viewModel]);

  const diffLayout = useMemo(() => {
    if (mode !== 'diff' || !viewModel || ticketIds.length !== 2) return null;
    return buildDiffLanesLayout(viewModel, ticketIds[0], ticketIds[1]);
  }, [mode, viewModel, ticketIds]);

  if (mode === 'hotspot') {
    return (
      <div className="flex flex-1 flex-col min-h-0" role="region" aria-label="Graph visualization">
        <GraphSearchTray
          projectId={projectId}
          selectedTicketIds={ticketIds}
          ticketLabels={ticketLabels}
          onAddTicket={addTicket}
          onRemoveTicket={removeTicket}
        />
        <ModeBar
          mode={mode}
          onModeChange={setMode}
          hasTickets={ticketIds.length > 0}
          canDiff={ticketIds.length === 2}
          apiData={graphQuery.data ?? null}
          viewModel={viewModel}
        />
        <ErrorBoundary>
          <GraphHotspotView
            projectId={projectId}
            windowDays={prefs.hotspotWindowDays}
            onWindowChange={setHotspotWindowDays}
          />
        </ErrorBoundary>
      </div>
    );
  }

  if (ticketIds.length === 0) {
    return (
      <div className="flex flex-1 flex-col min-h-0" role="region" aria-label="Graph visualization">
        <GraphSearchTray
          projectId={projectId}
          selectedTicketIds={ticketIds}
          ticketLabels={ticketLabels}
          onAddTicket={addTicket}
          onRemoveTicket={removeTicket}
        />
        <ModeBar
          mode={mode}
          onModeChange={setMode}
          hasTickets={false}
          canDiff={false}
          apiData={null}
          viewModel={null}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Network className="h-12 w-12 opacity-40" aria-hidden="true" />
            <p className="text-sm">
              Search for tickets above to visualize their codebase relationships.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col min-h-0" role="region" aria-label="Graph visualization">
        <GraphSearchTray
          projectId={projectId}
          selectedTicketIds={ticketIds}
          ticketLabels={ticketLabels}
          onAddTicket={addTicket}
          onRemoveTicket={removeTicket}
        />
        <div
          className="flex flex-1 items-center justify-center"
          role="status"
          aria-label="Loading graph"
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Loading graph data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col min-h-0" role="region" aria-label="Graph visualization">
        <GraphSearchTray
          projectId={projectId}
          selectedTicketIds={ticketIds}
          ticketLabels={ticketLabels}
          onAddTicket={addTicket}
          onRemoveTicket={removeTicket}
        />
        <div className="flex flex-1 items-center justify-center" role="alert">
          <div className="flex flex-col items-center gap-2 text-destructive">
            <p className="text-sm font-medium">Failed to load graph</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!viewModel || viewModel.nodes.length === 0) {
    return (
      <div className="flex flex-1 flex-col min-h-0" role="region" aria-label="Graph visualization">
        <GraphSearchTray
          projectId={projectId}
          selectedTicketIds={ticketIds}
          ticketLabels={ticketLabels}
          onAddTicket={addTicket}
          onRemoveTicket={removeTicket}
        />
        <ModeBar
          mode={mode}
          onModeChange={setMode}
          hasTickets={ticketIds.length > 0}
          canDiff={ticketIds.length === 2}
          apiData={graphQuery.data ?? null}
          viewModel={null}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Network className="h-12 w-12 opacity-40" aria-hidden="true" />
            <p className="text-sm">No file change rationales found for the selected tickets.</p>
          </div>
        </div>
      </div>
    );
  }

  const showScrubber = mode === 'replay';
  const fixedPositions = diffLayout?.positions ?? null;

  return (
    <div className="flex flex-1 flex-col min-h-0" role="region" aria-label="Graph visualization">
      <GraphSearchTray
        projectId={projectId}
        selectedTicketIds={ticketIds}
        ticketLabels={ticketLabels}
        onAddTicket={addTicket}
        onRemoveTicket={removeTicket}
      />
      <ModeBar
        mode={mode}
        onModeChange={setMode}
        hasTickets={ticketIds.length > 0}
        canDiff={ticketIds.length === 2}
        apiData={graphQuery.data ?? null}
        viewModel={viewModel}
      />
      <div className="flex items-center gap-2 px-4 py-1.5 border-b">
        <Network className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-medium">Graph</h2>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {viewModel.ticketNodes.size} ticket{viewModel.ticketNodes.size !== 1 ? 's' : ''},{' '}
          {viewModel.fileNodes.size} file{viewModel.fileNodes.size !== 1 ? 's' : ''},{' '}
          {viewModel.edges.length} edge{viewModel.edges.length !== 1 ? 's' : ''}
          {viewModel.coChangeEdges.length > 0 && <>, {viewModel.coChangeEdges.length} co-change</>}
          {mode === 'diff' && diffLayout && (
            <>
              {' · '}
              {diffLayout.shared.length} shared / {diffLayout.onlyA.length} only-left /{' '}
              {diffLayout.onlyB.length} only-right
            </>
          )}
        </span>
      </div>

      {viewModel.aggregatedFileCount > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2 border-b bg-amber-500/10 text-amber-700 dark:text-amber-400"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs">
            Large graph detected ({viewModel.aggregatedFileCount} files). Files have been aggregated
            into directory groups for performance.{' '}
            <button className="underline hover:no-underline" onClick={() => setAggregated(false)}>
              Show all files
            </button>
          </p>
        </div>
      )}

      {viewModel.isLargeGraph && viewModel.aggregatedFileCount === 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2 border-b bg-amber-500/10 text-amber-700 dark:text-amber-400"
          role="status"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs">
            Large graph ({viewModel.nodes.length} nodes). Performance may be affected.{' '}
            <button className="underline hover:no-underline" onClick={() => setAggregated(true)}>
              Aggregate by directory
            </button>
          </p>
        </div>
      )}

      {showScrubber && (
        <GraphTimeScrubber
          bounds={viewModel.timeBounds}
          value={filters.maxTime}
          onChange={maxTime => setFilters(f => ({ ...f, maxTime }))}
          isPlaying={isPlaying}
          onPlayToggle={() => setIsPlaying(v => !v)}
        />
      )}
      <GraphFiltersBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        availableChangeKinds={viewModel.allChangeKinds}
        availableImpacts={viewModel.allImpacts}
        availableDirectories={viewModel.allDirectories}
        availableStatusTypes={viewModel.allStatusTypes}
      />
      <div className="flex flex-1 min-h-0">
        <ErrorBoundary>
          {isMobile ? (
            <GraphMobileList
              viewModel={viewModel}
              apiData={graphQuery.data ?? null}
              onExpandFile={handleExpandFile}
            />
          ) : (
            <div className="flex-1 min-h-0">
              <ReactFlowProvider>
                <GraphCanvas
                  viewModel={viewModel}
                  focusedNodeId={focusedNodeId}
                  onSelectionChange={handleSelectionChange}
                  fixedPositions={fixedPositions}
                />
              </ReactFlowProvider>
            </div>
          )}
        </ErrorBoundary>
        {!isMobile && (
          <GraphDetailsPanel
            selection={selection}
            apiData={graphQuery.data ?? null}
            onClose={handleCloseDetails}
            onExpandFile={handleExpandFile}
          />
        )}
      </div>
    </div>
  );
}

function ModeBar({
  mode,
  onModeChange,
  hasTickets,
  canDiff,
  apiData,
  viewModel
}: {
  mode: GraphMode;
  onModeChange: (m: GraphMode) => void;
  hasTickets: boolean;
  canDiff: boolean;
  apiData: Parameters<typeof ExportGraphMenu>[0]['apiData'];
  viewModel: Parameters<typeof ExportGraphMenu>[0]['viewModel'];
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b bg-card/20">
      <GraphModeSwitcher
        mode={mode}
        onModeChange={onModeChange}
        canDiff={canDiff}
        hasTickets={hasTickets}
      />
      <div className="flex items-center gap-1">
        <ExportGraphMenu apiData={apiData} viewModel={viewModel} />
        <GraphHelpDialog />
      </div>
    </div>
  );
}
