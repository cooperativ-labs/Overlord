'use client';

import type { SimulationNodeDatum } from 'd3-force';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { useEffect, useRef } from 'react';

import type { GraphViewModel } from './view-model';
import { topDirectory } from './view-model';

interface SimNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  group: string;
}

interface SimLink {
  source: string;
  target: string;
}

const DIRECTORY_HUES_X: Record<string, number> = {};
let nextDirSlot = 0;

function dirXTarget(dir: string, totalDirs: number): number {
  if (!(dir in DIRECTORY_HUES_X)) {
    DIRECTORY_HUES_X[dir] = nextDirSlot++;
  }
  const slot = DIRECTORY_HUES_X[dir];
  const spread = Math.max(totalDirs * 120, 400);
  return 500 + (slot / Math.max(totalDirs - 1, 1)) * spread - spread / 2;
}

export function useForceLayout(
  viewModel: GraphViewModel | null,
  onPositionsReady: (positions: Map<string, { x: number; y: number }>) => void
) {
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);

  useEffect(() => {
    if (!viewModel || viewModel.nodes.length === 0) return;

    simRef.current?.stop();

    const directories = viewModel.allDirectories;
    const totalDirs = directories.length;

    // Reset directory slots for this layout run
    for (const key of Object.keys(DIRECTORY_HUES_X)) delete DIRECTORY_HUES_X[key];
    nextDirSlot = 0;

    const simNodes: SimNode[] = viewModel.nodes.map(node => {
      const isTicket = node.id.startsWith('ticket-');
      const dir = isTicket
        ? '__ticket__'
        : topDirectory((node.data as { filePath?: string }).filePath ?? '');
      return {
        id: node.id,
        x: isTicket ? 0 : dirXTarget(dir, totalDirs),
        y: node.position.y + Math.random() * 20,
        group: isTicket ? '__ticket__' : dir
      };
    });

    const simLinks: SimLink[] = viewModel.edges
      .filter(e => e.type === 'rationale')
      .map(e => ({ source: e.source, target: e.target }));

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id(d => d.id)
          .distance(180)
          .strength(0.3)
      )
      .force('charge', forceManyBody().strength(-200).distanceMax(600))
      .force('collide', forceCollide<SimNode>(40))
      .force(
        'x',
        forceX<SimNode>(d => {
          if (d.group === '__ticket__') return 0;
          return dirXTarget(d.group, totalDirs);
        }).strength(0.15)
      )
      .force('y', forceY<SimNode>(0).strength(0.02))
      .alphaDecay(0.04)
      .on('end', () => {
        const positions = new Map<string, { x: number; y: number }>();
        for (const n of simNodes) {
          positions.set(n.id, { x: n.x, y: n.y });
        }
        onPositionsReady(positions);
      });

    simRef.current = sim;

    // Run synchronously for small graphs for snappy feel
    if (simNodes.length < 200) {
      sim.stop();
      for (let i = 0; i < 120; i++) sim.tick();
      const positions = new Map<string, { x: number; y: number }>();
      for (const n of simNodes) {
        positions.set(n.id, { x: n.x, y: n.y });
      }
      onPositionsReady(positions);
    }

    return () => {
      sim.stop();
    };
  }, [viewModel, onPositionsReady]);
}
