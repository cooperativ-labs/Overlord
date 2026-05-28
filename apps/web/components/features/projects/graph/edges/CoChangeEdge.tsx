'use client';

import type { EdgeProps } from '@xyflow/react';
import { BaseEdge, getStraightPath } from '@xyflow/react';

import type { CoChangeEdgeData } from '../types';

export function CoChangeEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, data, style } = props;
  const d = data as unknown as CoChangeEdgeData | undefined;

  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY
  });

  const strokeWidth = d ? Math.min(d.sharedFileCount, 4) : 1;

  return (
    <BaseEdge
      path={edgePath}
      style={{
        ...style,
        stroke: '#f59e0b',
        strokeWidth,
        strokeDasharray: '6 3',
        strokeOpacity: 0.5
      }}
    />
  );
}
