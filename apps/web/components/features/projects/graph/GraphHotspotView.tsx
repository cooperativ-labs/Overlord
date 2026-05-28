'use client';

import '@xyflow/react/dist/style.css';

import type { Node } from '@xyflow/react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState
} from '@xyflow/react';
import { Flame, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useProjectHotspotsQuery } from '@/lib/client-data/project-graph/hooks';

import { HotspotNode } from './nodes/HotspotNode';
import { buildHotspotViewModel } from './view-model';

const nodeTypes = { hotspot: HotspotNode };

const WINDOW_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'Last 180 days', value: 180 },
  { label: 'Last year', value: 365 }
];

interface GraphHotspotViewProps {
  projectId: string;
  windowDays: number;
  onWindowChange: (days: number) => void;
  onSelectFile?: (filePath: string) => void;
}

export function GraphHotspotView({
  projectId,
  windowDays,
  onWindowChange,
  onSelectFile
}: GraphHotspotViewProps) {
  const { data, isLoading, error } = useProjectHotspotsQuery({
    projectId,
    windowDays
  });

  const viewModel = useMemo(
    () => (data ? buildHotspotViewModel(data.hotspots, data.windowDays) : null),
    [data]
  );

  const windowLabel =
    WINDOW_OPTIONS.find(w => w.value === windowDays)?.label ?? `Last ${windowDays} days`;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b">
        <Flame className="h-4 w-4 text-orange-500" />
        <h2 className="text-sm font-medium">Hotspots</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              {windowLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {WINDOW_OPTIONS.map(w => (
              <DropdownMenuItem
                key={w.value}
                onClick={() => onWindowChange(w.value)}
                className="text-xs"
              >
                {w.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {viewModel && (
          <span className="text-xs text-muted-foreground ml-2">
            {viewModel.hotspots.length} file{viewModel.hotspots.length !== 1 ? 's' : ''} touched
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-destructive">{error.message}</p>
          </div>
        )}
        {!isLoading && !error && viewModel && (
          <ReactFlowProvider>
            <HotspotCanvas nodes={viewModel.nodes} onSelectFile={onSelectFile} />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}

function HotspotCanvas({
  nodes: initialNodes,
  onSelectFile
}: {
  nodes: Node[];
  onSelectFile?: (filePath: string) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const fp = (node.data as { filePath?: string }).filePath;
      if (fp && onSelectFile) onSelectFile(fp);
    },
    [onSelectFile]
  );

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);
  const [hasInit, setHasInit] = useState(false);
  useEffect(() => {
    if (!hasInit && nodes.length > 0) setHasInit(true);
  }, [hasInit, nodes.length]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No file activity in this window.
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      proOptions={proOptions}
      fitView
      minZoom={0.1}
      maxZoom={2}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#334155" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
