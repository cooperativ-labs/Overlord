'use client';

import { ProjectColorDot } from '@/components/features/projects/ProjectColorDot';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

type Project = {
  id: string;
  name: string;
  color: string;
};

type FeedProjectFilterProps = {
  projects: Project[];
  value: string;
  onChange: (value: string) => void;
};

export function FeedProjectFilter({ projects, value, onChange }: FeedProjectFilterProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[150px] backdrop-blur-sm">
        <SelectValue placeholder="All Projects" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          <span className="flex items-center gap-2">All Projects</span>
        </SelectItem>
        {projects.map(project => (
          <SelectItem key={project.id} value={project.id}>
            <span className="flex items-center gap-2">
              <ProjectColorDot color={project.color} />
              {project.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
