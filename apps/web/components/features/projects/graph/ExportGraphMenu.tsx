'use client';

import { Copy, Download, FileImage, FileText } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

import { buildSvgSnapshot, downloadBlob } from './export/image';
import { buildMermaidExport } from './export/mermaid';
import type { GraphApiResponse } from './types';
import type { GraphViewModel } from './view-model';

interface ExportGraphMenuProps {
  apiData: GraphApiResponse | null;
  viewModel: GraphViewModel | null;
}

export function ExportGraphMenu({ apiData, viewModel }: ExportGraphMenuProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopyMermaid = async () => {
    if (!apiData) return;
    const mermaid = buildMermaidExport(apiData);
    await navigator.clipboard.writeText(mermaid);
    setCopied('mermaid');
    setTimeout(() => setCopied(null), 1500);
  };

  const handleDownloadMermaid = () => {
    if (!apiData) return;
    const mermaid = buildMermaidExport(apiData);
    downloadBlob(new Blob([mermaid], { type: 'text/markdown' }), 'graph.md');
  };

  const handleDownloadSvg = () => {
    if (!viewModel) return;
    const svg = buildSvgSnapshot(viewModel.nodes, viewModel.edges);
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'graph.svg');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs">Mermaid Markdown</DropdownMenuLabel>
        <DropdownMenuItem className="text-xs" onClick={handleCopyMermaid} disabled={!apiData}>
          <Copy className="h-3.5 w-3.5 mr-2" />
          {copied === 'mermaid' ? 'Copied!' : 'Copy to clipboard'}
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={handleDownloadMermaid} disabled={!apiData}>
          <FileText className="h-3.5 w-3.5 mr-2" />
          Download .md
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Image</DropdownMenuLabel>
        <DropdownMenuItem className="text-xs" onClick={handleDownloadSvg} disabled={!viewModel}>
          <FileImage className="h-3.5 w-3.5 mr-2" />
          Download SVG snapshot
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
