'use client';

import { Info } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function DefaultTooltipLabel() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="truncate">Default</span>
          <Info aria-hidden className="h-3 w-3 shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Last used in terminal</TooltipContent>
    </Tooltip>
  );
}

export function CursorAutoTooltipLabel() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="truncate">Auto</span>
          <Info aria-hidden className="h-3 w-3 shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Cursor picks the model automatically</TooltipContent>
    </Tooltip>
  );
}
