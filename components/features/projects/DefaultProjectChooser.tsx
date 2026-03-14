'use client';

import { useEffect, useRef, useState } from 'react';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { ProjectWorkingDirectoryRequiredModal } from '@/components/features/projects/ProjectWorkingDirectoryRequiredModal';
import { useElectron } from '@/components/features/terminal/useElectron';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function DefaultProjectChooser({ className }: { className?: string }) {
  const { isElectron } = useElectron();
  const { defaultProject, defaultProjectId, projects, setDefaultProjectId, isPending } =
    useDefaultProject();
  const [projectNeedingDirectory, setProjectNeedingDirectory] = useState<
    (typeof projects)[number] | null
  >(null);
  const promptedDefaultProjectIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!isElectron || !defaultProject) {
      return;
    }

    const hasWorkingDirectory = Boolean(defaultProject.localWorkingDirectory?.trim());
    if (hasWorkingDirectory) {
      return;
    }

    if (promptedDefaultProjectIdsRef.current.has(defaultProject.id)) {
      return;
    }

    promptedDefaultProjectIdsRef.current.add(defaultProject.id);
    setProjectNeedingDirectory(defaultProject);
  }, [defaultProject, isElectron]);

  function handleSelectDefaultProject(projectId: string) {
    setDefaultProjectId(projectId);

    if (!isElectron) {
      return;
    }

    const selectedProject = projects.find(project => project.id === projectId) ?? null;
    if (!selectedProject) {
      return;
    }

    if (!selectedProject.localWorkingDirectory?.trim()) {
      setProjectNeedingDirectory(selectedProject);
    }
  }

  if (!projects.length) {
    return <p className="text-muted-foreground text-sm">No projects</p>;
  }

  return (
    <>
      <Select
        value={defaultProjectId ?? projects[0].id}
        onValueChange={handleSelectDefaultProject}
        disabled={isPending}
      >
        <SelectTrigger
          aria-label="Select default project"
          className={cn('h-8 min-w-56 max-w-[26rem]', className)}
        >
          <div className="flex w-full items-center gap-2">
            <SelectValue placeholder="Select default project" />{' '}
            <span className="text-muted-foreground text-sm">Default project</span>
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
      <ProjectWorkingDirectoryRequiredModal
        open={projectNeedingDirectory !== null}
        project={projectNeedingDirectory}
        onOpenChange={open => {
          if (!open) {
            setProjectNeedingDirectory(null);
          }
        }}
        onLinked={() => {
          setProjectNeedingDirectory(null);
        }}
      />
    </>
  );
}
