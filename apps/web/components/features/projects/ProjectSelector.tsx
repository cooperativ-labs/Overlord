'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type ProjectSelectorItem = {
  id: string;
  name: string;
  color: string;
};

export type ProjectSelectorProps = {
  projects: ProjectSelectorItem[];
  /** Selected project id, or the nullOption value (e.g. '__personal__', 'all'). */
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  /**
   * When provided, shows this item at the top of the list with a separator below.
   * Use for "Inbox", "No project / Inbox", "All Projects", etc.
   */
  nullOption?: { value: string; label: string };
  /**
   * - 'compact': h-6 borderless trigger (for inline, tight contexts like ticket headers)
   * - 'default': h-8 bordered trigger (for forms and modals)
   * - 'icon-only': DropdownMenu with a color-dot-only trigger (for icon buttons)
   */
  variant?: 'compact' | 'default' | 'icon-only';
  /** Extra classes applied to the SelectTrigger ('compact'/'default' variants only). */
  triggerClassName?: string;
  /** Content rendered after the project list inside the popover (e.g. "Create new project"). */
  footer?: ReactNode;
  /** Alignment of the popover relative to its trigger. */
  align?: 'start' | 'center' | 'end';
  /** 'icon-only' only: extra class on DropdownMenuContent for outside-click scoping. */
  menuScopeClassName?: string;
  /** 'icon-only' only: accessible label for the trigger button. */
  ariaLabel?: string;
};

function ProjectDot({
  color,
  size = 'md'
}: {
  color: string | null | undefined;
  size?: 'sm' | 'md';
}) {
  const sizeClass = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';
  if (color) {
    return (
      <span
        className={cn('shrink-0 rounded-[4px] border', sizeClass)}
        style={{ backgroundColor: color, borderColor: color }}
      />
    );
  }
  return (
    <span
      className={cn('shrink-0 rounded-[4px] border border-muted-foreground/50 bg-muted', sizeClass)}
    />
  );
}

export function ProjectSelector({
  projects,
  value,
  onValueChange,
  disabled,
  nullOption,
  variant = 'default',
  triggerClassName,
  footer,
  align = 'start',
  menuScopeClassName,
  ariaLabel
}: ProjectSelectorProps) {
  const selectedProject = projects.find(p => p.id === value) ?? null;
  const isNullSelected = nullOption ? value === nullOption.value : false;
  const displayName = selectedProject?.name ?? (isNullSelected ? (nullOption?.label ?? '') : '');

  if (variant === 'icon-only') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label={
              ariaLabel ?? (selectedProject ? `Project: ${selectedProject.name}` : 'Choose project')
            }
            disabled={disabled}
          >
            <ProjectDot color={selectedProject?.color} size="sm" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className={cn('w-52', menuScopeClassName)}>
          {nullOption && (
            <DropdownMenuItem
              className="gap-2"
              onSelect={event => {
                event.preventDefault();
                onValueChange(nullOption.value);
              }}
            >
              <ProjectDot color={null} size="sm" />
              <span className="flex-1 truncate">{nullOption.label}</span>
              {isNullSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          )}
          {projects.map(project => (
            <DropdownMenuItem
              key={project.id}
              className="gap-2"
              onSelect={event => {
                event.preventDefault();
                onValueChange(project.id);
              }}
            >
              <ProjectDot color={project.color} size="sm" />
              <span className="flex-1 truncate">{project.name}</span>
              {value === project.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const isCompact = variant === 'compact';

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        aria-label="Select project"
        className={cn(
          isCompact
            ? 'h-6 w-auto rounded-md border bg-transparent px-3 text-xs hover:bg-muted'
            : 'h-8 w-full border-border bg-background px-3 text-left shadow-sm hover:bg-accent hover:text-accent-foreground',
          triggerClassName
        )}
      >
        <span className={cn('flex min-w-0 items-center', isCompact ? 'gap-1.5' : 'gap-2 pr-2')}>
          <ProjectDot color={selectedProject?.color} size={isCompact ? 'sm' : 'md'} />
          <span className={cn('truncate', isCompact ? '' : 'text-sm font-medium')}>
            {displayName}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent align={align}>
        {nullOption && (
          <>
            <SelectItem value={nullOption.value}>{nullOption.label}</SelectItem>
            <SelectSeparator />
          </>
        )}
        {projects.map(project => (
          <SelectItem key={project.id} value={project.id}>
            <span className="flex items-center gap-2">
              <ProjectDot color={project.color} size="sm" />
              {project.name}
            </span>
          </SelectItem>
        ))}
        {footer && (
          <>
            <SelectSeparator />
            <div className="p-1 pt-2">{footer}</div>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
