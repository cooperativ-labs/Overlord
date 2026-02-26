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
  const { defaultProjectId, projects, setDefaultProjectId, isPending } = useDefaultProject();

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
        <SelectValue placeholder="Select default project" />
      </SelectTrigger>
      <SelectContent align="start">
        {projects.map(project => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
