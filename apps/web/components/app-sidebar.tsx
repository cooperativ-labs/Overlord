'use client';

import {
  ChevronDown,
  ExternalLink,
  GraduationCap,
  ListChecks,
  MessageSquarePlus,
  MoreHorizontal,
  Newspaper,
  Plus,
  Settings,
  Shield
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { useTutorialWizard } from '@/components/features/onboarding/TutorialWizardContext';
import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { ProjectColorSetter } from '@/components/features/projects/ProjectColorSetter';
import { useProjectCreator } from '@/components/features/projects/ProjectCreatorContext';
import { ProjectWorkingDirectoryRequiredModal } from '@/components/features/projects/ProjectWorkingDirectoryRequiredModal';
import { useAgentBundleNotifications } from '@/components/features/system-notifications';
import { useElectron } from '@/components/features/terminal/useElectron';
import { FeedbackModal } from '@/components/modals/FeedbackModal';
import { SettingsModal, type SettingsNavSection } from '@/components/modals/SettingsModal';
import { NavUser } from '@/components/nav-user';
import { TeamSwitcher } from '@/components/team-switcher';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar';
import type { UserOrganization } from '@/lib/actions/organizations';
import type { SidebarProject } from '@/lib/actions/project-types';
import { useUpdateProjectColorMutation } from '@/lib/client-data/projects/mutations';
import { useProjects } from '@/lib/client-data/tickets/hooks';
import { isWorkingDirectoryNone } from '@/lib/helpers/project-working-directory';

type AppSidebarUser = {
  name: string;
  email: string;
  avatar: string;
};

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  isAdmin: boolean;
  user: AppSidebarUser;
  projects: SidebarProject[];
  organizations: UserOrganization[];
  selectedOrgId: number | null;
};

type ProjectColorMenuProps = {
  projectId: string;
  color: string;
};

function ProjectColorMenu({ projectId, color }: ProjectColorMenuProps) {
  const updateProjectColorMutation = useUpdateProjectColorMutation();
  const [open, setOpen] = React.useState(false);

  async function handleChangeColor(nextColor: string) {
    if (nextColor.toLowerCase() === color.toLowerCase() || updateProjectColorMutation.isPending) {
      return;
    }

    try {
      await updateProjectColorMutation.mutateAsync({ projectId, color: nextColor.toLowerCase() });
      setOpen(false);
    } catch {
      // Mutation rollback restores the previous color; keep the menu open for another attempt.
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction showOnHover disabled={updateProjectColorMutation.isPending}>
          <MoreHorizontal />
          <span className="sr-only">Project options</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-auto rounded-lg">
        <div className="p-1">
          <ProjectColorSetter value={color} onSelect={handleChangeColor} />
        </div>
        <DropdownMenuSeparator className="my-1" />
        <div className="p-1">
          <DropdownMenuItem asChild className="text-xs p-1">
            <Link href={`/projects/${projectId}?projectSettings=1`}>
              <Settings size={16} />
              <span>Project settings</span>
            </Link>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ProjectMenuItemProps = {
  project: SidebarProject;
  isActive: boolean;
  onNavigationClick: (
    event: React.MouseEvent<HTMLAnchorElement>,
    project: SidebarProject,
    destinationPath: string
  ) => void;
};

function ProjectMenuItem({ project, isActive, onNavigationClick }: ProjectMenuItemProps) {
  return (
    <SidebarMenuItem key={project.id}>
      <SidebarMenuButton asChild isActive={isActive} tooltip={project.name}>
        <Link
          href={`/projects/${project.id}`}
          onClick={event => onNavigationClick(event, project, `/projects/${project.id}`)}
        >
          <span
            className="h-3 w-3 rounded-[6px] border group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4 group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:border-0"
            style={{ backgroundColor: project.color, borderColor: project.color }}
          />
          <span className="group-data-[collapsible=icon]:hidden">{project.name}</span>
        </Link>
      </SidebarMenuButton>
      <ProjectColorMenu projectId={project.id} color={project.color} />
    </SidebarMenuItem>
  );
}

type OrgGroupedProjectsProps = {
  projects: SidebarProject[];
  organizations: UserOrganization[];
  isProjectActive: (project: SidebarProject) => boolean;
  onNavigationClick: (
    event: React.MouseEvent<HTMLAnchorElement>,
    project: SidebarProject,
    destinationPath: string
  ) => void;
};

function OrgGroupedProjects({
  projects,
  organizations,
  isProjectActive,
  onNavigationClick
}: OrgGroupedProjectsProps) {
  const orgMap = React.useMemo(
    () => new Map(organizations.map(org => [org.id, org.name])),
    [organizations]
  );

  const groups = React.useMemo(() => {
    const map = new Map<number, SidebarProject[]>();
    for (const project of projects) {
      const list = map.get(project.organizationId) ?? [];
      list.push(project);
      map.set(project.organizationId, list);
    }
    return Array.from(map.entries()).map(([orgId, orgProjects]) => ({
      orgId,
      orgName: orgMap.get(orgId) ?? 'Unknown',
      projects: orgProjects
    }));
  }, [projects, orgMap]);

  const [collapsedOrgs, setCollapsedOrgs] = React.useState<Set<number>>(new Set());

  function toggleOrg(orgId: number) {
    setCollapsedOrgs(prev => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  }

  if (groups.length <= 1) {
    return (
      <SidebarMenu>
        {projects.map(project => (
          <ProjectMenuItem
            key={project.id}
            project={project}
            isActive={isProjectActive(project)}
            onNavigationClick={onNavigationClick}
          />
        ))}
      </SidebarMenu>
    );
  }

  return (
    <div className="space-y-1">
      {groups.map(({ orgId, orgName, projects: orgProjects }) => {
        const isOpen = !collapsedOrgs.has(orgId);
        return (
          <Collapsible key={orgId} open={isOpen} onOpenChange={() => toggleOrg(orgId)}>
            <CollapsibleTrigger className="group/org-trigger flex w-full items-center gap-1 px-2 py-1 text-xs font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors">
              <ChevronDown className="h-3 w-3 transition-transform group-data-[state=closed]/org-trigger:-rotate-90" />
              <span className="truncate group-data-[collapsible=icon]:hidden">{orgName}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenu>
                {orgProjects.map(project => (
                  <ProjectMenuItem
                    key={project.id}
                    project={project}
                    isActive={isProjectActive(project)}
                    onNavigationClick={onNavigationClick}
                  />
                ))}
              </SidebarMenu>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

export function AppSidebar({
  isAdmin,
  user,
  projects,
  organizations,
  selectedOrgId,
  ...props
}: AppSidebarProps) {
  const projectsQuery = useProjects(projects);
  const cachedProjects = projectsQuery.data ?? projects;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isElectron } = useElectron();
  const { openProjectCreator } = useProjectCreator();
  const { defaultProject } = useDefaultProject();
  const { openTutorial } = useTutorialWizard();
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsInitialNav, setSettingsInitialNav] = React.useState<
    SettingsNavSection | undefined
  >(undefined);
  const [projectNeedingDirectory, setProjectNeedingDirectory] =
    React.useState<SidebarProject | null>(null);
  const [pendingPath, setPendingPath] = React.useState<string | null>(null);

  const openSettings = React.useCallback((section?: SettingsNavSection) => {
    setSettingsInitialNav(section);
    setSettingsOpen(true);
  }, []);
  useAgentBundleNotifications(openSettings);

  const requestedSettingsSection = React.useMemo(() => {
    const requestedSection = searchParams.get('settings');
    if (!requestedSection) {
      return undefined;
    }

    if (requestedSection === 'Sessions') {
      return 'Linked Accounts';
    }
    if (requestedSection === 'Agent tokens') {
      return 'MCP & Cloud Agents';
    }

    return (['Profile', 'Linked Accounts', 'MCP & Cloud Agents'] as const).find(
      section => section === requestedSection
    );
  }, [searchParams]);

  React.useEffect(() => {
    if (!requestedSettingsSection) {
      return;
    }

    openSettings(requestedSettingsSection);

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete('settings');
    const nextHref = nextSearchParams.toString()
      ? `${pathname}?${nextSearchParams.toString()}`
      : pathname;
    router.replace(nextHref, { scroll: false });
  }, [openSettings, pathname, requestedSettingsSection, router, searchParams]);

  const defaultOrganizationId = React.useMemo(() => {
    if (selectedOrgId !== null) return selectedOrgId;
    if (defaultProject) return defaultProject.organizationId;
    return cachedProjects[0]?.organizationId ?? null;
  }, [selectedOrgId, defaultProject, cachedProjects]);

  const displayedProjects = React.useMemo(
    () =>
      selectedOrgId !== null
        ? cachedProjects.filter(p => p.organizationId === selectedOrgId)
        : cachedProjects,
    [selectedOrgId, cachedProjects]
  );

  // const isInboxActive = pathname === '/inbox' || pathname.startsWith('/inbox/');
  const isAdminActive = pathname === '/admin' || pathname.startsWith('/admin/');
  const isFeedActive = pathname === '/feed' || pathname.startsWith('/feed/');
  const isMyTicketsActive = pathname === '/u' || pathname.startsWith('/u/');

  function isProjectActive(project: SidebarProject) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return false;
    }
    const [segment, projectId] = segments;
    return segment === 'projects' && projectId === project.id;
  }

  function hasWorkingDirectory(project: SidebarProject | null): boolean {
    if (!project?.localWorkingDirectory) return false;
    return isWorkingDirectoryNone(project.localWorkingDirectory)
      ? true
      : project.localWorkingDirectory.trim().length > 0;
  }

  function handleProjectNavigationClick(
    event: React.MouseEvent<HTMLAnchorElement>,
    project: SidebarProject,
    destinationPath: string
  ) {
    if (!isElectron || hasWorkingDirectory(project)) {
      return;
    }

    event.preventDefault();
    setProjectNeedingDirectory(project);
    setPendingPath(destinationPath);
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher organizations={organizations} selectedOrgId={selectedOrgId} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isInboxActive} tooltip="Inbox">
                  <Link href="/inbox">
                    <Inbox />
                    <span>Inbox</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem> */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isFeedActive} tooltip="Feed">
                  <Link href="/feed">
                    <Newspaper />
                    <span>Feed</span>
                  </Link>
                </SidebarMenuButton>
                {isElectron && (
                  <SidebarMenuAction
                    title="Pop out feed"
                    onClick={() => window.electronAPI?.feedWindow.open()}
                  >
                    <ExternalLink />
                  </SidebarMenuAction>
                )}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isMyTicketsActive} tooltip="My Tickets">
                  <Link
                    href="/u"
                    onClick={event => {
                      if (!defaultProject) {
                        return;
                      }
                      handleProjectNavigationClick(event, defaultProject, '/u');
                    }}
                  >
                    <ListChecks />
                    <span>My Tickets</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {isAdmin ? (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isAdminActive} tooltip="Admin">
                    <Link href="/admin">
                      <Shield />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupAction
            type="button"
            aria-label="Add project"
            disabled={defaultOrganizationId === null}
            title={
              defaultOrganizationId === null
                ? 'Open a workspace to create a project'
                : 'Add project'
            }
            onClick={() => {
              if (defaultOrganizationId !== null) {
                openProjectCreator({ organizationId: defaultOrganizationId });
              }
            }}
          >
            <Plus className="h-3 w-3" />
          </SidebarGroupAction>
          <SidebarGroupContent>
            {selectedOrgId !== null ? (
              <SidebarMenu>
                {displayedProjects.map(project => (
                  <ProjectMenuItem
                    key={project.id}
                    project={project}
                    isActive={isProjectActive(project)}
                    onNavigationClick={handleProjectNavigationClick}
                  />
                ))}
              </SidebarMenu>
            ) : (
              <OrgGroupedProjects
                projects={displayedProjects}
                organizations={organizations}
                isProjectActive={isProjectActive}
                onNavigationClick={handleProjectNavigationClick}
              />
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Send Feedback" onClick={() => setFeedbackOpen(true)}>
              <MessageSquarePlus />
              <span>Feedback</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Tutorial" onClick={() => openTutorial()}>
              <GraduationCap />
              <span>Take Tutorial</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings" onClick={() => setSettingsOpen(true)}>
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser user={user} onOpenSettings={openSettings} />
      </SidebarFooter>
      <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <SettingsModal
        open={settingsOpen}
        onOpenChange={nextOpen => {
          setSettingsOpen(nextOpen);
          if (!nextOpen) {
            setSettingsInitialNav(undefined);
          }
        }}
        initialNav={settingsInitialNav}
      />
      <ProjectWorkingDirectoryRequiredModal
        open={projectNeedingDirectory !== null}
        project={projectNeedingDirectory}
        onOpenChange={open => {
          if (!open) {
            setProjectNeedingDirectory(null);
            setPendingPath(null);
          }
        }}
        onLinked={() => {
          if (pendingPath) {
            router.push(pendingPath);
          }
          setProjectNeedingDirectory(null);
          setPendingPath(null);
        }}
      />
      <SidebarRail />
    </Sidebar>
  );
}
