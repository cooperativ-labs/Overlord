'use client';

import { cn } from '@/lib/utils';

import type { ProjectOption } from './quick-task-helpers';

type ProjectPickerPanelProps = {
  projects: ProjectOption[];
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
};

export function ProjectPickerPanel({
  projects,
  selectedProjectId,
  onSelect
}: ProjectPickerPanelProps) {
  return (
    <div className="electron-no-drag max-h-[260px] overflow-y-auto rounded-xl border  bg-background/95 p-1  backdrop-blur-md m-4">
      {projects.length === 0 ? (
        <div className="px-2 py-2 text-xs text-muted-foreground">No projects</div>
      ) : (
        projects.map(project => (
          <button
            key={project.id}
            type="button"
            onClick={() => onSelect(project.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
              project.id === selectedProjectId && 'bg-muted/60'
            )}
          >
            <span
              className="h-3 w-3 rounded-[4px] border"
              style={{
                backgroundColor: project.color,
                borderColor: project.color
              }}
            />
            <span className="truncate">{project.name}</span>
          </button>
        ))
      )}
    </div>
  );
}
