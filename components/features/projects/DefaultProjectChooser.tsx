'use client';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function DefaultProjectChooser({ className }: { className?: string }) {
  const { defaultProject, defaultProjectId, projects, setDefaultProjectId, isPending } =
    useDefaultProject();

  if (!projects.length) {
    return <p className="text-muted-foreground text-sm">No projects</p>;
  }

  return (
    <Select
      value={defaultProjectId ?? projects[0].id}
      onValueChange={setDefaultProjectId}
      disabled={isPending}
    >
      <SelectTrigger
        aria-label="Select default project"
        className={cn('h-8 min-w-56 max-w-[26rem]', className)}
      >
        <div className="flex w-full items-center gap-2">
          <SelectValue placeholder="Select default project" />
        </div>
      </SelectTrigger>
      <SelectContent align="start">
        {projects.map(project => (
          <SelectItem key={project.id} value={project.id}>
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full border"
                style={{
                  backgroundColor: project.color,
                  borderColor: project.color
                }}
              />
              <span>{project.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
