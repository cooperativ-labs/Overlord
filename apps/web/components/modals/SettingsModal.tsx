'use client';

import {
  Bot,
  Edit3,
  Info,
  Key,
  Keyboard,
  Link2,
  Monitor,
  Palette,
  Server,
  Shield,
  Terminal,
  User,
  X
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog';
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
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from '@/components/ui/sidebar';

import { AboutPage } from './settings/AboutPage';
import { AgentsAndMcpPage } from './settings/AgentsAndMcpPage';
import { AgentTokensPage } from './settings/AgentTokensPage';
import { ApplicationPage } from './settings/ApplicationPage';
import { CliPage } from './settings/CliPage';
import { CustomizationPage } from './settings/CustomizationPage';
import { ExecutionTargetsPage } from './settings/ExecutionTargetsPage';
import { HotkeysPage } from './settings/HotkeysPage';
import { IntegrationsPage } from './settings/IntegrationsPage';
import { LinkedAccountsPage } from './settings/LinkedAccountsPage';
import { TerminalPage } from './settings/TerminalPage';
import { UserProfilePage } from './settings/UserProfilePage';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialNav?: SettingsNavSection;
  slackEnabled?: boolean;
};

type NavItem = {
  name: string;
  icon: React.ElementType;
  electronOnly?: boolean;
};

const workflowNavItems: NavItem[] = [
  { name: 'Terminal & IDE', icon: Monitor },
  { name: 'Execution Targets', icon: Server },
  { name: 'MCP & Cloud Agents', icon: Bot },
  { name: 'CLI & Local Agents', icon: Terminal },
  { name: 'Customization', icon: Edit3 }
];

const appNavItems: NavItem[] = [
  { name: 'Application', icon: Palette },
  { name: 'Hotkeys', icon: Keyboard },
  { name: 'Integrations', icon: Link2 },
  { name: 'About', icon: Info }
];

const userNavItems: NavItem[] = [
  { name: 'Profile', icon: User },
  { name: 'Agent Tokens', icon: Key },
  { name: 'Linked Accounts', icon: Shield }
];

const navItems: NavItem[] = [...workflowNavItems, ...appNavItems, ...userNavItems];
export type SettingsNavSection = (typeof navItems)[number]['name'];

export function SettingsModal({
  open,
  onOpenChange,
  initialNav,
  slackEnabled = false
}: SettingsModalProps) {
  const { isElectron } = useElectron();
  const visibleNavItems = navItems.filter(item => !item.electronOnly || isElectron);
  const visibleWorkflowNavItems = workflowNavItems.filter(item => !item.electronOnly || isElectron);
  const visibleAppNavItems = appNavItems.filter(item => !item.electronOnly || isElectron);
  const visibleUserNavItems = userNavItems.filter(item => !item.electronOnly || isElectron);
  const [activeNav, setActiveNav] = useState<string>('CLI & Local Agents');

  useEffect(() => {
    if (!open || !initialNav) return;
    if (!visibleNavItems.some(item => item.name === initialNav)) return;
    setActiveNav(initialNav);
  }, [open, initialNav, visibleNavItems]);

  useEffect(() => {
    if (visibleNavItems.length > 0 && !visibleNavItems.find(i => i.name === activeNav)) {
      setActiveNav(visibleNavItems[0]!.name);
    }
  }, [isElectron]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-dvh max-h-dvh w-full max-w-full overflow-hidden p-0 md:h-auto md:max-h-[680px] md:max-w-[900px] lg:max-w-[1000px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Customize your settings here.</DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex md:w-52">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Workflow</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleWorkflowNavItems.map(item => (
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
              <SidebarGroup>
                <SidebarGroupLabel>Application</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleAppNavItems.map(item => (
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
              <SidebarGroup>
                <SidebarGroupLabel>User</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleUserNavItems.map(item => (
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
                    {visibleNavItems.map(item => (
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
                      <BreadcrumbLink href="#">Settings</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeNav}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              <DialogClose className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <X className="size-5" />
                <span className="sr-only">Close settings</span>
              </DialogClose>
            </header>
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
              {activeNav === 'Integrations' && (
                <IntegrationsPage open={open} slackEnabled={slackEnabled} />
              )}
              {activeNav === 'MCP & Cloud Agents' && (
                <AgentsAndMcpPage open={open} onNavigate={setActiveNav} />
              )}
              {activeNav === 'Agent Tokens' && <AgentTokensPage open={open} />}
              {activeNav === 'Customization' && <CustomizationPage open={open} />}
              {activeNav === 'CLI & Local Agents' && (
                <CliPage open={open} onNavigate={setActiveNav} />
              )}
              {activeNav === 'Application' && <ApplicationPage />}
              {activeNav === 'Hotkeys' && <HotkeysPage />}
              {activeNav === 'Profile' && <UserProfilePage open={open} />}
              {activeNav === 'Linked Accounts' && <LinkedAccountsPage open={open} />}
              {activeNav === 'Terminal & IDE' && <TerminalPage open={open} />}
              {activeNav === 'Execution Targets' && (
                <ExecutionTargetsPage open={open} onNavigate={setActiveNav} />
              )}
              {activeNav === 'About' && <AboutPage open={open} />}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
