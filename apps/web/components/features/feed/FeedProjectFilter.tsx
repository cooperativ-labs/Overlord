'use client';

import { ProjectSelector } from '@/components/features/projects/ProjectSelector';

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
    <ProjectSelector
      projects={projects}
      value={value}
      onValueChange={onChange}
      nullOption={{ value: 'all', label: 'All Projects' }}
      triggerClassName="w-[150px] backdrop-blur-sm"
    />
  );
}
