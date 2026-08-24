import {
  FolderTree,
  GitBranch,
  HardDrive,
  Plug,
  Plus,
  Rocket,
  Settings,
  Tag,
  Trash2
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { DangerZonePage } from '@/components/projects/project-settings/DangerZonePage.tsx';
import { GeneralPage } from '@/components/projects/project-settings/GeneralPage.tsx';
import { IntegrationsPage } from '@/components/projects/project-settings/IntegrationsPage.tsx';
import { LaunchPage } from '@/components/projects/project-settings/LaunchPage.tsx';
import { AddResourcePage } from '@/components/projects/project-settings/resources/AddResourcePage.tsx';
import { ResourceDetailPage } from '@/components/projects/project-settings/resources/ResourceDetailPage.tsx';
import { ResourcesOverviewPage } from '@/components/projects/project-settings/resources/ResourcesOverviewPage.tsx';
import { StatusesPage } from '@/components/projects/project-settings/StatusesPage.tsx';
import { TagsPage } from '@/components/projects/project-settings/TagsPage.tsx';
import {
  SettingsDialogShell,
  type SettingsNavItem
} from '@/components/settings/SettingsDialogShell.tsx';
import { useProjectResources } from '@/lib/queries';

import type { ProjectDto } from '../../../shared/contract.ts';

const navItems: SettingsNavItem[] = [
  { name: 'General', icon: Settings },
  { name: 'Launch', icon: Rocket },
  { name: 'Tags', icon: Tag },
  { name: 'Card statuses', icon: GitBranch },
  { name: 'Integrations', icon: Plug },
  { name: 'Danger zone', icon: Trash2 }
];

/** Nav key of the Resources section landing page. */
const RESOURCES_NAV = 'Resources';
/** Nav key of the add-resource form page. */
const ADD_RESOURCE_NAV = 'resources:add';
const RESOURCE_NAV_PREFIX = 'resource:';

const resourceNavKey = (resourceId: string) => `${RESOURCE_NAV_PREFIX}${resourceId}`;

function resourceIdFromNav(nav: string): string | null {
  return nav.startsWith(RESOURCE_NAV_PREFIX) ? nav.slice(RESOURCE_NAV_PREFIX.length) : null;
}

export type ProjectSettingsNavSection = (typeof navItems)[number]['name'] | typeof RESOURCES_NAV;

type ProjectSettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDto;
  initialNav?: ProjectSettingsNavSection;
};

export function ProjectSettingsModal({
  open,
  onOpenChange,
  project,
  initialNav
}: ProjectSettingsModalProps) {
  const [activeNav, setActiveNav] = useState<string>('General');
  const resourcesQ = useProjectResources(project.id);
  const resources = resourcesQ.data ?? [];

  useEffect(() => {
    if (!open) return;

    if (
      initialNav &&
      (initialNav === RESOURCES_NAV || navItems.some(item => item.name === initialNav))
    ) {
      setActiveNav(initialNav);
      return;
    }

    setActiveNav('General');
  }, [open, initialNav]);

  // A resource page whose resource disappeared (deleted here or elsewhere) falls
  // back to the section landing page rather than rendering an empty shell.
  useEffect(() => {
    const resourceId = resourceIdFromNav(activeNav);
    if (!resourceId || resourcesQ.isLoading) return;
    if (!(resourcesQ.data ?? []).some(resource => resource.id === resourceId)) {
      setActiveNav(RESOURCES_NAV);
    }
  }, [activeNav, resourcesQ.data, resourcesQ.isLoading]);

  const resourceNavItems: SettingsNavItem[] = [
    { key: RESOURCES_NAV, name: 'Overview', icon: FolderTree },
    ...resources.map(resource => ({
      key: resourceNavKey(resource.id),
      name: resource.resourceKey,
      icon: resource.sources.every(source => source.sourceKind === 'git') ? GitBranch : HardDrive
    })),
    { key: ADD_RESOURCE_NAV, name: 'Add resource', icon: Plus }
  ];

  const activeResourceId = resourceIdFromNav(activeNav);

  return (
    <SettingsDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Project settings"
      description="Customize your project settings here."
      breadcrumbRoot="Project settings"
      navGroups={[{ items: navItems }, { label: 'Resources', items: resourceNavItems }]}
      activeNav={activeNav}
      onActiveNavChange={setActiveNav}
    >
      {activeNav === 'General' && (
        <GeneralPage
          open={open}
          project={project}
          onOpenChange={onOpenChange}
          onNavigateToIntegrations={() => setActiveNav('Integrations')}
        />
      )}
      {activeNav === 'Launch' && <LaunchPage open={open} projectId={project.id} />}
      {activeNav === RESOURCES_NAV && (
        <ResourcesOverviewPage
          open={open}
          projectId={project.id}
          onSelectResource={resourceId => setActiveNav(resourceNavKey(resourceId))}
          onAddResource={() => setActiveNav(ADD_RESOURCE_NAV)}
        />
      )}
      {activeNav === ADD_RESOURCE_NAV && (
        <AddResourcePage
          projectId={project.id}
          onCreated={resource => setActiveNav(resourceNavKey(resource.id))}
        />
      )}
      {activeResourceId ? (
        <ResourceDetailPage
          key={activeResourceId}
          projectId={project.id}
          resourceId={activeResourceId}
          onDeleted={() => setActiveNav(RESOURCES_NAV)}
        />
      ) : null}
      {activeNav === 'Tags' && <TagsPage projectId={project.id} />}
      {activeNav === 'Card statuses' && <StatusesPage projectId={project.id} />}
      {activeNav === 'Integrations' && <IntegrationsPage open={open} project={project} />}
      {activeNav === 'Danger zone' && (
        <DangerZonePage
          projectId={project.id}
          projectName={project.name}
          isArchived={project.status === 'archived'}
          onOpenChange={onOpenChange}
        />
      )}
    </SettingsDialogShell>
  );
}
