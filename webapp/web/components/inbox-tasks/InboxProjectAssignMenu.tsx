import { Check, ChevronDown, FolderOpen, Loader2 } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu.tsx';
import { useAccessibleWorkspaces, useAllProjects } from '@/lib/queries.ts';
import { cn } from '@/lib/utils';

/**
 * Row-level project chooser for an Inbox task. Picking a project is the
 * task-list shortcut for "make this a mission": the caller promotes on select,
 * so the menu itself carries no confirm step. Grouped by workspace only when
 * the caller can see more than one, mirroring the Inbox card's picker.
 */
export function InboxProjectAssignMenu({
  selectedProjectId = null,
  disabled = false,
  pending = false,
  compact = false,
  onSelect
}: {
  selectedProjectId?: string | null;
  disabled?: boolean;
  pending?: boolean;
  /** Icon-only trigger that stays hidden until the row is hovered. */
  compact?: boolean;
  onSelect: (projectId: string) => void;
}) {
  const projectsQ = useAllProjects();
  const workspaces = useAccessibleWorkspaces();
  const projects = projectsQ.data.filter(project => project.status === 'active');
  const groups = workspaces
    .map(workspace => ({
      workspace,
      projects: projects.filter(project => project.workspaceId === workspace.id)
    }))
    .filter(group => group.projects.length > 0);
  const showWorkspaceGroups = groups.length > 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || projects.length === 0}
        aria-label="Assign to project"
        title="Assign to project — creates a mission there"
        onClick={event => event.stopPropagation()}
        className={cn(
          'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed border-input px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60',
          compact &&
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100'
        )}
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <FolderOpen className="h-3 w-3" />
        )}
        {compact ? null : <span>Project</span>}
        {compact ? null : <ChevronDown className="h-3 w-3" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuLabel>Assign to project</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {groups.map((group, groupIndex) => (
          <div key={group.workspace.id}>
            {showWorkspaceGroups ? (
              <>
                {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                  {group.workspace.name}
                </DropdownMenuLabel>
              </>
            ) : null}
            {group.projects.map(project => (
              <DropdownMenuItem
                key={project.id}
                className="gap-2 text-xs"
                onClick={event => {
                  event.stopPropagation();
                  onSelect(project.id);
                }}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-[4px] border"
                  style={{
                    backgroundColor: project.color ?? undefined,
                    borderColor: project.color ?? undefined
                  }}
                />
                <span className="truncate">{project.name}</span>
                {project.id === selectedProjectId ? (
                  <Check className="ml-auto h-3 w-3 text-muted-foreground" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
