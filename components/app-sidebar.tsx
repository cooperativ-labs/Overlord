'use client';

import { GraduationCap, Inbox, ListChecks, MoreHorizontal, Plus, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { useTutorialWizard } from '@/components/features/onboarding/TutorialWizardContext';
import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { ProjectColorSetter } from '@/components/features/projects/ProjectColorSetter';
import { useProjectCreator } from '@/components/features/projects/ProjectCreatorContext';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { NavUser } from '@/components/nav-user';
import { TeamSwitcher } from '@/components/team-switcher';
import {
  DropdownMenu,
  DropdownMenuContent,
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
import type { SidebarProject } from '@/lib/actions/projects';
import { updateProjectColorAction } from '@/lib/actions/projects';

type AppSidebarUser = {
  name: string;
  email: string;
  avatar: string;
};

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
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
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isUpdating, setIsUpdating] = React.useState(false);

  async function handleChangeColor(nextColor: string) {
    if (nextColor.toLowerCase() === color.toLowerCase() || isUpdating) {
      return;
    }

    setIsUpdating(true);
    try {
      await updateProjectColorAction({ projectId, color: nextColor.toLowerCase() });
      router.refresh();
      setOpen(false);
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction showOnHover disabled={isUpdating}>
          <MoreHorizontal />
          <span className="sr-only">Project options</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-auto rounded-lg p-2">
        <ProjectColorSetter value={color} onSelect={handleChangeColor} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar({
  user,
  projects,
  organizations,
  selectedOrgId,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname();
  const { openProjectCreator } = useProjectCreator();
  const { defaultProject } = useDefaultProject();
  const { openTutorial } = useTutorialWizard();
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const defaultOrganizationId = React.useMemo(() => {
    if (selectedOrgId !== null) return selectedOrgId;
    if (defaultProject) return defaultProject.organizationId;
    return projects[0]?.organizationId ?? null;
  }, [selectedOrgId, defaultProject, projects]);

  const displayedProjects = React.useMemo(
    () =>
      selectedOrgId !== null ? projects.filter(p => p.organizationId === selectedOrgId) : projects,
    [selectedOrgId, projects]
  );

  // const isInboxActive = pathname === '/inbox' || pathname.startsWith('/inbox/');
  const isMyTasksActive = pathname === '/u' || pathname.startsWith('/u/');

  function isProjectActive(project: SidebarProject) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return false;
    }
    const [segment, projectId] = segments;
    return segment === 'projects' && projectId === project.id;
  }

  return (
    <Sidebar collapsible="icon" variant="floating" {...props}>
      <SidebarHeader className="electron-sidebar-offset">
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
                <SidebarMenuButton asChild isActive={isMyTasksActive} tooltip="My Tasks">
                  <Link href="/u">
                    <ListChecks />
                    <span>My Tasks</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
            <SidebarMenu>
              {displayedProjects.map(project => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={isProjectActive(project)}
                    tooltip={project.name}
                  >
                    <Link href={`/projects/${project.id}`}>
                      <span
                        className="h-3 w-3 rounded-[6px] border group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4 group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:border-0"
                        style={{
                          backgroundColor: project.color,
                          borderColor: project.color
                        }}
                      />
                      <span className="group-data-[collapsible=icon]:hidden">{project.name}</span>
                    </Link>
                  </SidebarMenuButton>
                  <ProjectColorMenu projectId={project.id} color={project.color} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Tutorial" onClick={() => openTutorial({ startAtStep: 3 })}>
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
        <NavUser user={user} />
      </SidebarFooter>
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SidebarRail />
    </Sidebar>
  );
}
