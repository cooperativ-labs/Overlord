import type { Edge, Node } from '@xyflow/react';

import { CHANGE_KIND_COLORS, STATUS_TYPE_COLORS } from '../types';

/**
 * Renders an SVG snapshot of the current graph view-model. We render directly
 * from the data (rather than rasterizing the live DOM) so the export stays
 * dependency-free. This is intentionally a schematic snapshot — not a
 * pixel-perfect canvas capture.
 */
export function buildSvgSnapshot(nodes: Node[], edges: Edge[]): string {
  if (nodes.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="20" y="30" font-family="sans-serif" font-size="12" fill="#64748b">Empty graph</text></svg>';
  }

  const positions = nodes.map(n => n.position);
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const padding = 60;
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const maxX = Math.max(...xs) + padding + 200;
  const maxY = Math.max(...ys) + padding + 60;
  const width = maxX - minX;
  const height = maxY - minY;

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${Math.min(width, 1600)}" height="${Math.min(height, 1200)}">`
  );
  lines.push(
    '<rect x="' +
      minX +
      '" y="' +
      minY +
      '" width="' +
      width +
      '" height="' +
      height +
      '" fill="#0f172a"/>'
  );

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  for (const edge of edges) {
    const a = nodeById.get(edge.source);
    const b = nodeById.get(edge.target);
    if (!a || !b) continue;
    const stroke =
      (edge.style?.stroke as string | undefined) ??
      CHANGE_KIND_COLORS[(edge.data as { changeKind?: string } | undefined)?.changeKind ?? ''] ??
      '#64748b';
    const dasharray = edge.type === 'cochange' ? ' stroke-dasharray="6 3"' : '';
    lines.push(
      `<line x1="${a.position.x + 90}" y1="${a.position.y + 20}" x2="${b.position.x + 10}" y2="${b.position.y + 10}" stroke="${stroke}" stroke-width="1.5"${dasharray} opacity="0.7"/>`
    );
  }

  for (const node of nodes) {
    const d = node.data as {
      type?: string;
      shortId?: string;
      title?: string;
      fileName?: string;
      statusType?: string | null;
      heatColor?: string;
    };
    const x = node.position.x;
    const y = node.position.y;
    if (d.type === 'ticket') {
      const color = STATUS_TYPE_COLORS[d.statusType ?? ''] ?? '#64748b';
      lines.push(`<g transform="translate(${x},${y})">`);
      lines.push(
        `<rect width="180" height="44" rx="6" fill="#1e293b" stroke="${color}" stroke-width="2"/>`
      );
      lines.push(
        `<text x="10" y="18" font-family="monospace" font-size="10" fill="#94a3b8">${escapeXml(d.shortId ?? '')}</text>`
      );
      lines.push(
        `<text x="10" y="34" font-family="sans-serif" font-size="11" fill="#f1f5f9">${escapeXml((d.title ?? '').slice(0, 28))}</text>`
      );
      lines.push('</g>');
    } else if (d.type === 'hotspot') {
      lines.push(`<g transform="translate(${x},${y})">`);
      lines.push(
        `<rect width="160" height="32" rx="4" fill="${d.heatColor ?? '#f59e0b'}" stroke="${d.heatColor ?? '#f59e0b'}"/>`
      );
      lines.push(
        `<text x="8" y="20" font-family="monospace" font-size="11" fill="#1e293b">${escapeXml((d.fileName ?? '').slice(0, 24))}</text>`
      );
      lines.push('</g>');
    } else {
      lines.push(`<g transform="translate(${x},${y})">`);
      lines.push(`<rect width="160" height="32" rx="4" fill="#0f172a" stroke="#64748b"/>`);
      lines.push(
        `<text x="8" y="20" font-family="monospace" font-size="10" fill="#cbd5e1">${escapeXml((d.fileName ?? '').slice(0, 26))}</text>`
      );
      lines.push('</g>');
    }
  }

  lines.push('</svg>');
  return lines.join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
