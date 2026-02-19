'use client';

import { Inbox, ListChecks, MoreHorizontal, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { NavUser } from '@/components/nav-user';
import { TeamSwitcher } from '@/components/team-switcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
};

const presetProjectColors = [
  '#d4d4d8',
  '#f87171',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#2dd4bf',
  '#38bdf8',
  '#818cf8',
  '#c084fc',
  '#f472b6'
];

type ProjectColorMenuProps = {
  projectId: string;
  color: string;
};

function ProjectColorMenu({ projectId, color }: ProjectColorMenuProps) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = React.useState(false);

  async function handleChangeColor(nextColor: string) {
    if (nextColor === color || isUpdating) {
      return;
    }

    setIsUpdating(true);
    try {
      await updateProjectColorAction({ projectId, color: nextColor });
      router.refresh();
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction showOnHover disabled={isUpdating}>
          <MoreHorizontal />
          <span className="sr-only">Project options</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-44 rounded-lg">
        {presetProjectColors.map(nextColor => (
          <DropdownMenuItem
            key={nextColor}
            className="gap-2"
            onClick={() => handleChangeColor(nextColor)}
          >
            <span
              className="h-3 w-3 rounded-[6px] border"
              style={{ backgroundColor: nextColor, borderColor: nextColor }}
            />
            <span className="text-xs">
              {nextColor.toLowerCase() === color.toLowerCase() ? 'Current color' : nextColor}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar({ user, projects, ...props }: AppSidebarProps) {
  const pathname = usePathname();

  const isInboxActive = pathname === '/inbox' || pathname.startsWith('/inbox/');
  const isMyTasksActive = pathname === '/u' || pathname.startsWith('/u/');

  function isProjectActive(project: SidebarProject) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length < 3) {
      return false;
    }

    const [, segment, projectId] = segments;
    return segment === 'projects' && projectId === project.id;
  }

  const teams = [
    {
      name: 'Default Workspace',
      logo: Inbox,
      plan: 'Agent orchestration'
    }
  ];

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={teams} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isInboxActive} tooltip="Inbox">
                  <Link href="/inbox">
                    <Inbox />
                    <span>Inbox</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
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

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupAction asChild>
            <button type="button" aria-label="Add project">
              <Plus className="h-3 w-3" />
            </button>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map(project => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={isProjectActive(project)}
                    tooltip={project.name}
                  >
                    <Link href={`/${project.organizationId}/projects/${project.id}`}>
                      <span
                        className="h-3 w-3 rounded-[6px] border"
                        style={{
                          backgroundColor: project.color,
                          borderColor: project.color
                        }}
                      />
                      <span>{project.name}</span>
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
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
