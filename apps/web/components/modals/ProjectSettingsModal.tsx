'use client';

import {
  FolderTree,
  GitBranch,
  GitCommit,
  Link2,
  Newspaper,
  Settings,
  Tag,
  Trash2
} from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ProjectSshAuthMethod } from '@/lib/actions/project-types';
import type { Database } from '@/types/database.types';

import { CheckpointsPage } from './project-settings/CheckpointsPage';
import { DangerZonePage } from './project-settings/DangerZonePage';
import { FeedPage } from './project-settings/FeedPage';
import { GeneralPage } from './project-settings/GeneralPage';
import { IntegrationsPage } from './project-settings/IntegrationsPage';
import { ResourcesPage } from './project-settings/ResourcesPage';
import { TagsPage } from './project-settings/TagsPage';
import { WorkflowPage } from './project-settings/WorkflowPage';
import { SettingsDialogShell, type SettingsNavItem } from './SettingsDialogShell';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

const navItems: SettingsNavItem[] = [
  { name: 'General', icon: Settings },
  { name: 'Resources', icon: FolderTree },
  { name: 'Workflow', icon: GitBranch },
  { name: 'Tags', icon: Tag },
  { name: 'Feed', icon: Newspaper },
  { name: 'Integrations', icon: Link2 },
  { name: 'Checkpoints', icon: GitCommit },
  { name: 'Danger zone', icon: Trash2 }
];

export type ProjectSettingsNavSection = (typeof navItems)[number]['name'];

type ProjectSettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  organizationId: number;
  initialName: string;
  initialColor: string;
  initialWorkingDirectory: string | null;
  initialSshCommand: string | null;
  initialRemoteWorkingDirectory: string | null;
  initialSshHost: string | null;
  initialSshPort: number | null;
  initialSshUser: string | null;
  initialSshAuthMethod: ProjectSshAuthMethod | null;
  initialSshPrivateKeyPath: string | null;
  initialEverhourProjectId: string | null;
  initialEverhourProjectName: string | null;
  isArchived?: boolean;
  initialStatuses: Array<{
    name: string;
    position: number;
    statusType: TicketStatusType;
    isDefault: boolean;
  }>;
  hasEverhourApiKey: boolean;
  sshFeatureEnabled: boolean;
  slackEnabled?: boolean;
  initialNav?: ProjectSettingsNavSection;
};

export function ProjectSettingsModal({
  open,
  onOpenChange,
  projectId,
  organizationId,
  initialName,
  initialColor,
  initialWorkingDirectory: _initialWorkingDirectory,
  initialSshCommand: _initialSshCommand,
  initialRemoteWorkingDirectory,
  initialSshHost,
  initialSshPort,
  initialSshUser,
  initialSshAuthMethod,
  initialSshPrivateKeyPath,
  initialEverhourProjectId,
  initialEverhourProjectName,
  isArchived = false,
  initialStatuses,
  hasEverhourApiKey,
  sshFeatureEnabled,
  slackEnabled = false,
  initialNav
}: ProjectSettingsModalProps) {
  const [activeNav, setActiveNav] = useState<string>('Resources');

  useEffect(() => {
    if (!open) return;

    if (initialNav && navItems.some(item => item.name === initialNav)) {
      setActiveNav(initialNav);
      return;
    }

    setActiveNav('Resources');
  }, [open, initialNav]);

  return (
    <SettingsDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Project settings"
      description="Customize your project settings here."
      navGroups={[{ items: navItems }]}
      activeNav={activeNav}
      onActiveNavChange={setActiveNav}
    >
      {activeNav === 'General' && (
        <GeneralPage
          open={open}
          projectId={projectId}
          organizationId={organizationId}
          initialName={initialName}
          initialColor={initialColor}
        />
      )}
      {activeNav === 'Resources' && (
        <ResourcesPage
          open={open}
          projectId={projectId}
          initialSshHost={initialSshHost}
          initialSshPort={initialSshPort}
          initialSshUser={initialSshUser}
          initialSshAuthMethod={initialSshAuthMethod}
          initialSshPrivateKeyPath={initialSshPrivateKeyPath}
          initialRemoteWorkingDirectory={initialRemoteWorkingDirectory}
          sshFeatureEnabled={sshFeatureEnabled}
        />
      )}
      {activeNav === 'Workflow' && (
        <WorkflowPage
          projectId={projectId}
          organizationId={organizationId}
          initialStatuses={initialStatuses}
        />
      )}

      {activeNav === 'Tags' && <TagsPage open={open} projectId={projectId} />}
      {activeNav === 'Feed' && <FeedPage open={open} projectId={projectId} />}
      {activeNav === 'Integrations' && (
        <IntegrationsPage
          projectId={projectId}
          organizationId={organizationId}
          projectName={initialName}
          initialEverhourProjectId={initialEverhourProjectId}
          initialEverhourProjectName={initialEverhourProjectName}
          hasEverhourApiKey={hasEverhourApiKey}
          slackEnabled={slackEnabled}
          open={open}
        />
      )}
      {activeNav === 'Checkpoints' && <CheckpointsPage open={open} projectId={projectId} />}
      {activeNav === 'Danger zone' && (
        <DangerZonePage
          projectId={projectId}
          projectName={initialName}
          isArchived={isArchived}
          onOpenChange={onOpenChange}
        />
      )}
    </SettingsDialogShell>
  );
}
