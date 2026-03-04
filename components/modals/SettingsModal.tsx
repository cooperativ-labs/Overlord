'use client';

import { Bot, Edit3, Link2, Monitor, Palette, RefreshCcw, Terminal } from 'lucide-react';
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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
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

import { AgentsAndMcpPage } from './settings/AgentsAndMcpPage';
import { AppearancePage } from './settings/AppearancePage';
import { CliPage } from './settings/CliPage';
import { CustomizationPage } from './settings/CustomizationPage';
import { IntegrationsPage } from './settings/IntegrationsPage';
import { TerminalPage } from './settings/TerminalPage';
import { UpdatesPage } from './settings/UpdatesPage';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type NavItem = {
  name: string;
  icon: React.ElementType;
  electronOnly?: boolean;
};

const navItems: NavItem[] = [
  { name: 'Integrations', icon: Link2 },
  { name: 'Agents & MCP', icon: Bot },
  { name: 'Customization', icon: Edit3 },
  { name: 'CLI', icon: Terminal },
  { name: 'Appearance', icon: Palette },
  { name: 'Terminal', icon: Monitor, electronOnly: true },
  { name: 'Updates', icon: RefreshCcw, electronOnly: true }
];

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { isElectron } = useElectron();
  const visibleNavItems = navItems.filter(item => !item.electronOnly || isElectron);
  const [activeNav, setActiveNav] = useState<string>('Integrations');

  useEffect(() => {
    if (visibleNavItems.length > 0 && !visibleNavItems.find(i => i.name === activeNav)) {
      setActiveNav(visibleNavItems[0]!.name);
    }
  }, [isElectron]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 md:max-h-[560px] md:max-w-[700px] lg:max-w-[800px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Customize your settings here.</DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleNavItems.map(item => (
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
          <main className="flex h-[540px] flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2 border-b">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">Settings</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeNav}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
              {activeNav === 'Integrations' && <IntegrationsPage open={open} />}
              {activeNav === 'Agents & MCP' && <AgentsAndMcpPage open={open} />}
              {activeNav === 'Customization' && <CustomizationPage open={open} />}
              {activeNav === 'CLI' && <CliPage open={open} />}
              {activeNav === 'Appearance' && <AppearancePage />}
              {activeNav === 'Terminal' && isElectron && <TerminalPage open={open} />}
              {activeNav === 'Updates' && isElectron && <UpdatesPage open={open} />}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
