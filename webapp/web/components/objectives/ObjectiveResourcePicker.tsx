import type { ProjectResourceDto } from '@overlord/contract';
import { Check, ChevronDown, FolderOpen } from 'lucide-react';
import { useState } from 'react';

import {
  distinctProjectResourceKeys,
  primaryResourceConnection
} from '../../lib/project-resources.ts';
import { cn } from '../../lib/utils.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

export type ObjectiveResourceOptions = {
  /** One entry per logical resource key, labelled by its first resource's label. */
  choices: { key: string; label: string }[];
  /** The key the objective runs against: its own, else the project primary. */
  effectiveKey: string;
  /** The project primary key. Choosing it stores null (inherit the primary). */
  primaryKey: string | null;
  currentLabel: string;
};

/**
 * The resource choices an objective offers, or null when there is nothing to choose (one or no
 * logical resource key). Shared by the toolbar picker and the objective row menu (coo:1289).
 */
export function objectiveResourceOptions(
  resources: ProjectResourceDto[],
  value: string | null
): ObjectiveResourceOptions | null {
  const resourceKeys = distinctProjectResourceKeys(resources);
  if (resourceKeys.length <= 1) return null;

  const primaryKey = primaryResourceConnection(resources).primary?.resourceKey ?? null;
  const effectiveKey = value ?? primaryKey ?? resourceKeys[0] ?? null;
  if (!effectiveKey) return null;

  const labelsByKey = new Map<string, string>();
  for (const resource of resources) {
    if (!labelsByKey.has(resource.resourceKey)) {
      labelsByKey.set(resource.resourceKey, resource.label?.trim() || resource.resourceKey);
    }
  }
  return {
    choices: resourceKeys.map(key => ({ key, label: labelsByKey.get(key) ?? key })),
    effectiveKey,
    primaryKey,
    currentLabel: labelsByKey.get(effectiveKey) ?? effectiveKey
  };
}

type ObjectiveResourcePickerProps = {
  /**
   * Reports the popup opening and closing. Hosts that commit on leaving their
   * card (GhostObjective) use it to ignore focus and clicks in the portal.
   */
  onOpenChange?: (open: boolean) => void;
  resources: ProjectResourceDto[];
  value: string | null;
  onChange: (resourceKey: string | null) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Resource picker for objectives. Rendered only when the project has more than
 * one logical resource key. A null value inherits the project primary resource.
 */
export function ObjectiveResourcePicker({
  resources,
  value,
  onChange,
  disabled = false,
  className,
  onOpenChange
}: ObjectiveResourcePickerProps) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const options = objectiveResourceOptions(resources, value);
  if (!options) return null;
  const { choices, effectiveKey, primaryKey, currentLabel } = options;
  const triggerLabel = `Choose resource: ${currentLabel}`;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              disabled={disabled}
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm transition-colors',
                'max-w-[230px] @max-[360px]/objective-toolbar:px-2',
                disabled
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
                className
              )}
              aria-label={triggerLabel}
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[120px] truncate @max-[360px]/objective-toolbar:hidden">
                {currentLabel}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 @max-[360px]/objective-toolbar:hidden" />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent side="top">Sets which resource the agent will run against.</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuLabel className="flex items-center">
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="sr-only">Resource</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {choices.map(({ key, label }) => (
          <DropdownMenuItem
            key={key}
            className="gap-2 text-xs"
            onClick={() => onChange(key === primaryKey ? null : key)}
          >
            <span className="truncate">{label}</span>
            {effectiveKey === key ? (
              <Check className="ml-auto h-3 w-3 text-muted-foreground" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
