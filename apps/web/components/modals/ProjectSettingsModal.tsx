'use client';

import { Bot, GitBranch, Link2, Newspaper, Settings, Tag, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from '@/components/ui/sidebar';
import type { ProjectSshAuthMethod } from '@/lib/actions/project-types';
import type { Database } from '@/types/database.types';

import { AgentsPage } from './project-settings/AgentsPage';
import { DangerZonePage } from './project-settings/DangerZonePage';
import { FeedPage } from './project-settings/FeedPage';
import { GeneralPage } from './project-settings/GeneralPage';
import { IntegrationsPage } from './project-settings/IntegrationsPage';
import { TagsPage } from './project-settings/TagsPage';
import { WorkflowPage } from './project-settings/WorkflowPage';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

type NavItem = {
  name: string;
  icon: React.ElementType;
};

const navItems: NavItem[] = [
  { name: 'General', icon: Settings },
  { name: 'Workflow', icon: GitBranch },
  { name: 'Tags', icon: Tag },
  { name: 'Feed', icon: Newspaper },
  { name: 'Integrations', icon: Link2 },
  { name: 'Agents', icon: Bot },
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
  initialLocalVersionControl: 'off' | 'jj';
  initialLocalVersionControlInstalledAt: string | null;
  initialLocalVersionControlError: string | null;
  initialSshCommand: string | null;
  initialRemoteWorkingDirectory: string | null;
  initialSshHost: string | null;
  initialSshPort: number | null;
  initialSshUser: string | null;
  initialSshAuthMethod: ProjectSshAuthMethod | null;
  initialSshPrivateKeyPath: string | null;
  initialEverhourProjectId: string | null;
  initialStatuses: Array<{
    name: string;
    position: number;
    statusType: TicketStatusType;
    isDefault: boolean;
  }>;
  hasEverhourApiKey: boolean;
  initialNav?: ProjectSettingsNavSection;
};

export function ProjectSettingsModal({
  open,
  onOpenChange,
  projectId,
  organizationId,
  initialName,
  initialColor,
  initialWorkingDirectory,
  initialLocalVersionControl,
  initialLocalVersionControlInstalledAt,
  initialLocalVersionControlError,
  initialSshCommand,
  initialRemoteWorkingDirectory,
  initialSshHost,
  initialSshPort,
  initialSshUser,
  initialSshAuthMethod,
  initialSshPrivateKeyPath,
  initialEverhourProjectId,
  initialStatuses,
  hasEverhourApiKey,
  initialNav
}: ProjectSettingsModalProps) {
  const [activeNav, setActiveNav] = useState<string>('Workflow');

  useEffect(() => {
    if (!open) return;

    if (initialNav && navItems.some(item => item.name === initialNav)) {
      setActiveNav(initialNav);
      return;
    }

    setActiveNav('Workflow');
  }, [open, initialNav]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-dvh max-h-dvh w-full max-w-full overflow-hidden p-0 md:h-auto md:max-h-[680px] md:max-w-[900px] lg:max-w-[1000px]">
        <DialogTitle className="sr-only">Project settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize your project settings here.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex md:w-52">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.map(item => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          isActive={item.name === activeNav}
                          onClick={() => setActiveNav(item.name)}
                        >
                          <item.icon />
                          <span>{item.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-dvh flex-1 flex-col overflow-hidden md:max-h-[680px]">
            <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
              {/* Mobile: page selector dropdown */}
              <div className="flex w-full items-center md:hidden">
                <Select value={activeNav} onValueChange={setActiveNav}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {navItems.map(item => (
                      <SelectItem key={item.name} value={item.name}>
                        <div className="flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          <span>{item.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Desktop: breadcrumb */}
              <div className="hidden items-center gap-2 md:flex">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink href="#">Project settings</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeNav}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
              {activeNav === 'General' && (
                <GeneralPage
                  open={open}
                  projectId={projectId}
                  organizationId={organizationId}
                  initialName={initialName}
                  initialColor={initialColor}
                />
              )}
              {activeNav === 'Workflow' && (
                <WorkflowPage
                  projectId={projectId}
                  organizationId={organizationId}
                  initialWorkingDirectory={initialWorkingDirectory}
                  initialLocalVersionControl={initialLocalVersionControl}
                  initialLocalVersionControlInstalledAt={initialLocalVersionControlInstalledAt}
                  initialLocalVersionControlError={initialLocalVersionControlError}
                  initialSshCommand={initialSshCommand}
                  initialRemoteWorkingDirectory={initialRemoteWorkingDirectory}
                  initialSshHost={initialSshHost}
                  initialSshPort={initialSshPort}
                  initialSshUser={initialSshUser}
                  initialSshAuthMethod={initialSshAuthMethod}
                  initialSshPrivateKeyPath={initialSshPrivateKeyPath}
                  initialStatuses={initialStatuses}
                />
              )}
              {activeNav === 'Tags' && <TagsPage open={open} projectId={projectId} />}
              {activeNav === 'Feed' && <FeedPage open={open} projectId={projectId} />}
              {activeNav === 'Integrations' && (
                <IntegrationsPage
                  projectId={projectId}
                  organizationId={organizationId}
                  initialEverhourProjectId={initialEverhourProjectId}
                  hasEverhourApiKey={hasEverhourApiKey}
                  open={open}
                />
              )}
              {activeNav === 'Agents' && <AgentsPage open={open} projectId={projectId} />}
              {activeNav === 'Danger zone' && (
                <DangerZonePage
                  projectId={projectId}
                  projectName={initialName}
                  onOpenChange={onOpenChange}
                />
              )}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
