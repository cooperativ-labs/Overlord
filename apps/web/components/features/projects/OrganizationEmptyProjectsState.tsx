'use client';

import { FolderPlus } from 'lucide-react';

import { useProjectCreator } from '@/components/features/projects/ProjectCreatorContext';
import { Button } from '@/components/ui/button';

type OrganizationEmptyProjectsStateProps = {
  organizationId: number;
  organizationName: string;
};

export function OrganizationEmptyProjectsState({
  organizationId,
  organizationName
}: OrganizationEmptyProjectsStateProps) {
  const { openProjectCreator } = useProjectCreator();

  return (
    <div className="mx-4 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center md:mx-6">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FolderPlus className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No projects in {organizationName} yet</p>
        <p className="text-xs text-muted-foreground">
          Create a project to start tracking tickets in this workspace.
        </p>
      </div>
      <Button type="button" size="sm" onClick={() => openProjectCreator({ organizationId })}>
        Create project
      </Button>
    </div>
  );
}
