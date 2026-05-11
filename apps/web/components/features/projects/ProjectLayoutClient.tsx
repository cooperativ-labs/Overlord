'use client';

import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';

import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { ProjectSettingsProvider } from '@/components/features/projects/ProjectSettingsContext';
import { ProjectSettingsSection } from '@/components/features/projects/ProjectSettingsSection';
import { useElectron } from '@/components/features/terminal/useElectron';
import type { ProjectSshAuthMethod } from '@/lib/actions/project-types';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

function ProjectSettingsUrlTrigger() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const projectSettings = useProjectSettings();

  useEffect(() => {
    if (!projectSettings || searchParams.get('projectSettings') !== '1') {
      return;
    }

    projectSettings.openProjectSettings();

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete('projectSettings');
    const nextHref = nextSearchParams.toString()
      ? `${pathname}?${nextSearchParams.toString()}`
      : pathname;
    router.replace(nextHref, { scroll: false });
  }, [pathname, projectSettings, router, searchParams]);

  return null;
}

type ProjectLayoutClientProps = {
  board: ReactNode;
  children: ReactNode;
  projectId: string;
  organizationId: number;
  projectName: string;
  projectColor: string;
  projectWorkingDirectory: string | null;
  projectLocalVersionControl: 'off' | 'jj';
  projectLocalVersionControlInstalledAt: string | null;
  projectLocalVersionControlError: string | null;
  projectSshCommand: string | null;
  projectRemoteWorkingDirectory: string | null;
  projectSshHost: string | null;
  projectSshPort: number | null;
  projectSshUser: string | null;
  projectSshAuthMethod: ProjectSshAuthMethod | string | null;
  projectSshPrivateKeyPath: string | null;
  projectEverhourProjectId: string | null;
  statuses: Array<{
    name: string;
    position: number;
    status_type: TicketStatusType;
    is_default: boolean;
  }>;
  hasEverhourApiKey: boolean;
};

export function ProjectLayoutClient({
  board,
  children,
  projectId,
  organizationId,
  projectName,
  projectColor,
  projectWorkingDirectory,
  projectLocalVersionControl,
  projectLocalVersionControlInstalledAt,
  projectLocalVersionControlError,
  projectSshCommand,
  projectRemoteWorkingDirectory,
  projectSshHost,
  projectSshPort,
  projectSshUser,
  projectSshAuthMethod,
  projectSshPrivateKeyPath,
  projectEverhourProjectId,
  statuses,
  hasEverhourApiKey
}: ProjectLayoutClientProps) {
  const { isElectron } = useElectron();
  const pathname = usePathname();
  const router = useRouter();
  const selectedSegment = useSelectedLayoutSegment();
  const initialStatuses = useMemo(
    () =>
      statuses.map(s => ({
        name: s.name,
        position: s.position,
        statusType: s.status_type,
        isDefault: s.is_default
      })),
    [statuses]
  );

  useEffect(() => {
    if (!isElectron) return;

    const handleCurrentChangesHotkey = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.altKey ||
        event.key !== '.'
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'textbox')
      ) {
        return;
      }

      event.preventDefault();
      if (pathname.startsWith(`/projects/${projectId}/current-changes`)) {
        router.push(`/projects/${projectId}`);
        return;
      }
      router.push(`/projects/${projectId}/current-changes`);
    };

    window.addEventListener('keydown', handleCurrentChangesHotkey);
    return () => window.removeEventListener('keydown', handleCurrentChangesHotkey);
  }, [isElectron, pathname, projectId, router]);

  return (
    <ProjectSettingsProvider
      projectId={projectId}
      organizationId={organizationId}
      initialName={projectName}
      initialColor={projectColor}
      initialWorkingDirectory={projectWorkingDirectory}
      initialLocalVersionControl={projectLocalVersionControl}
      initialLocalVersionControlInstalledAt={projectLocalVersionControlInstalledAt}
      initialLocalVersionControlError={projectLocalVersionControlError}
      initialSshCommand={projectSshCommand}
      initialRemoteWorkingDirectory={projectRemoteWorkingDirectory}
      initialSshHost={projectSshHost}
      initialSshPort={projectSshPort}
      initialSshUser={projectSshUser}
      initialSshAuthMethod={projectSshAuthMethod as ProjectSshAuthMethod | null}
      initialSshPrivateKeyPath={projectSshPrivateKeyPath}
      initialEverhourProjectId={projectEverhourProjectId}
      initialStatuses={initialStatuses}
      hasEverhourApiKey={hasEverhourApiKey}
    >
      <ProjectSettingsUrlTrigger />
      <div className="flex flex-1 min-h-0 flex-col gap-5">
        <ProjectSettingsSection
          projectId={projectId}
          initialName={projectName}
          initialColor={projectColor}
          initialWorkingDirectory={projectWorkingDirectory}
          initialSshCommand={projectSshCommand}
          initialRemoteWorkingDirectory={projectRemoteWorkingDirectory}
        />
        {selectedSegment === 'current-changes' ? children : board}
        {selectedSegment === 'current-changes' ? null : children}
      </div>
    </ProjectSettingsProvider>
  );
}
