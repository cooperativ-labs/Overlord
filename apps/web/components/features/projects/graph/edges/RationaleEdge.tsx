'use client';

import type { EdgeProps } from '@xyflow/react';
import { BaseEdge, getStraightPath } from '@xyflow/react';

import type { RationaleEdgeData } from '../types';
import { CHANGE_KIND_COLORS, IMPACT_STROKE_WIDTH } from '../types';

export function RationaleEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, data, style } = props;
  const d = data as unknown as RationaleEdgeData | undefined;

  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY
  });

  const stroke = d
    ? (CHANGE_KIND_COLORS[d.changeKind] ?? '#64748b')
    : ((style?.stroke as string) ?? '#64748b');
  const strokeWidth = d ? (IMPACT_STROKE_WIDTH[d.impact] ?? 1) : 1;

  return (
    <BaseEdge
      path={edgePath}
      style={{
        ...style,
        stroke,
        strokeWidth,
        strokeOpacity: 0.6
      }}
    />
  );
}
