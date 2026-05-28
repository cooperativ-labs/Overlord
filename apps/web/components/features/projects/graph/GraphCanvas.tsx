'use client';

import '@xyflow/react/dist/style.css';

import type { Edge, Node } from '@xyflow/react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { CoChangeEdge } from './edges/CoChangeEdge';
import { RationaleEdge } from './edges/RationaleEdge';
import { FileNode } from './nodes/FileNode';
import { TicketNode } from './nodes/TicketNode';
import type { SelectionTarget } from './GraphDetailsPanel';
import { useForceLayout } from './useForceLayout';
import type { GraphViewModel } from './view-model';

const nodeTypes = {
  ticket: TicketNode,
  file: FileNode
};

const edgeTypes = {
  rationale: RationaleEdge,
  cochange: CoChangeEdge
};

interface GraphCanvasProps {
  viewModel: GraphViewModel;
  focusedNodeId: string | null;
  onSelectionChange: (selection: SelectionTarget) => void;
  /** When provided, force layout is skipped and these positions are used directly. */
  fixedPositions?: Map<string, { x: number; y: number }> | null;
}

function getConnectedIds(nodeId: string, edges: Edge[]): Set<string> {
  const ids = new Set<string>();
  ids.add(nodeId);
  for (const edge of edges) {
    if (edge.source === nodeId) ids.add(edge.target);
    if (edge.target === nodeId) ids.add(edge.source);
  }
  return ids;
}

function applyHighlights(
  nodes: Node[],
  edges: Edge[],
  focusedId: string | null
): { nodes: Node[]; edges: Edge[] } {
  if (!focusedId) {
    return {
      nodes: nodes.map(n => ({
        ...n,
        data: { ...n.data, highlighted: false }
      })),
      edges: edges.map(e => ({
        ...e,
        style: { ...e.style, opacity: undefined }
      }))
    };
  }

  const connected = getConnectedIds(focusedId, edges);

  return {
    nodes: nodes.map(n => ({
      ...n,
      data: {
        ...n.data,
        highlighted: connected.has(n.id),
        dimmed: n.data.dimmed || !connected.has(n.id)
      }
    })),
    edges: edges.map(e => ({
      ...e,
      style: {
        ...e.style,
        opacity: e.source === focusedId || e.target === focusedId ? 1 : 0.1
      }
    }))
  };
}

export function GraphCanvas({
  viewModel,
  focusedNodeId,
  onSelectionChange,
  fixedPositions
}: GraphCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(viewModel.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(viewModel.edges);
  const { fitView } = useReactFlow();
  const layoutApplied = useRef(false);

  const onPositionsReady = useCallback(
    (positions: Map<string, { x: number; y: number }>) => {
      setNodes(currentNodes =>
        currentNodes.map(node => {
          const pos = positions.get(node.id);
          if (!pos) return node;
          return { ...node, position: { x: pos.x, y: pos.y } };
        })
      );
      layoutApplied.current = true;
      requestAnimationFrame(() => {
        fitView({ padding: 0.15, duration: 300 });
      });
    },
    [setNodes, fitView]
  );

  useForceLayout(fixedPositions ? null : viewModel, onPositionsReady);

  useEffect(() => {
    if (!fixedPositions) return;
    onPositionsReady(fixedPositions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedPositions]);

  useEffect(() => {
    const { nodes: highlightedNodes, edges: highlightedEdges } = applyHighlights(
      viewModel.nodes,
      viewModel.edges,
      focusedNodeId
    );

    if (layoutApplied.current) {
      setNodes(currentNodes =>
        currentNodes.map(node => {
          const updated = highlightedNodes.find(n => n.id === node.id);
          if (!updated) return node;
          return { ...node, data: updated.data };
        })
      );
    } else {
      setNodes(highlightedNodes);
    }
    setEdges(highlightedEdges);
  }, [viewModel, focusedNodeId, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectionChange({ kind: 'node', node });
    },
    [onSelectionChange]
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      onSelectionChange({ kind: 'edge', edge });
    },
    [onSelectionChange]
  );

  const onPaneClick = useCallback(() => {
    onSelectionChange(null);
  }, [onSelectionChange]);

  const onInit = useCallback(() => {
    if (!layoutApplied.current) {
      fitView({ padding: 0.15 });
    }
  }, [fitView]);

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={onInit}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        proOptions={proOptions}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ animated: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#334155" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          className="!bg-background/80 !border-border"
          maskColor="rgba(0,0,0,0.2)"
        />
      </ReactFlow>
    </div>
  );
}
