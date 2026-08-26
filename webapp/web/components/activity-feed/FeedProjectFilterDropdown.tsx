import { FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu.tsx';

import type { FeedProjectOption } from './activity-feed-model.ts';
import { ProjectDot } from './ActivityFeedCardChrome.tsx';

const ALL_PROJECTS_VALUE = '__all_projects__';

/** A compact single-project filter for the aggregate activity feed. */
export function FeedProjectFilterDropdown({
  projects,
  projectId,
  onProjectChange
}: {
  projects: FeedProjectOption[];
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
}) {
  const selectedProject = projects.find(project => project.projectId === projectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-7 max-w-[12rem] gap-1.5 px-2 text-xs"
            aria-label="Filter feed by project"
          />
        }
      >
        {selectedProject ? (
          <ProjectDot color={selectedProject.projectColor} />
        ) : (
          <FolderOpen className="size-3" />
        )}
        <span className="truncate">{selectedProject?.projectName ?? 'All projects'}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Filter by project</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={projectId ?? ALL_PROJECTS_VALUE}
          onValueChange={value => onProjectChange(value === ALL_PROJECTS_VALUE ? null : value)}
        >
          <DropdownMenuRadioItem value={ALL_PROJECTS_VALUE}>All projects</DropdownMenuRadioItem>
          {projects.map(project => (
            <DropdownMenuRadioItem
              key={project.projectId}
              value={project.projectId}
              className="gap-2"
            >
              <ProjectDot color={project.projectColor} />
              <span className="truncate">{project.projectName}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {project.count}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
