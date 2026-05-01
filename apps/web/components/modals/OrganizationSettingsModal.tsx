'use client';

import { Newspaper, Settings, Trash2, Users } from 'lucide-react';
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
import {
  getOrganizationDetailsAction,
  type OrganizationDetails
} from '@/lib/actions/organizations';

import { DangerZonePage } from './organization-settings/DangerZonePage';
import { FeedPage } from './organization-settings/FeedPage';
import { GeneralPage } from './organization-settings/GeneralPage';
import { MembersPage } from './organization-settings/MembersPage';

type NavItem = {
  name: string;
  icon: React.ElementType;
};

const navItems: NavItem[] = [
  { name: 'General', icon: Settings },
  { name: 'Members', icon: Users },
  { name: 'Feed', icon: Newspaper },
  { name: 'Danger zone', icon: Trash2 }
];

export type OrganizationSettingsNavSection = (typeof navItems)[number]['name'];

type OrganizationSettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: number | null;
  initialNav?: OrganizationSettingsNavSection;
};

export function OrganizationSettingsModal({
  open,
  onOpenChange,
  organizationId,
  initialNav
}: OrganizationSettingsModalProps) {
  const [activeNav, setActiveNav] = useState<string>('General');
  const [details, setDetails] = useState<OrganizationDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialNav && navItems.some(item => item.name === initialNav)) {
      setActiveNav(initialNav);
    } else {
      setActiveNav('General');
    }
  }, [open, initialNav]);

  useEffect(() => {
    if (!open || organizationId === null) {
      setDetails(null);
      return;
    }
    setLoading(true);
    setError(null);
    getOrganizationDetailsAction(organizationId)
      .then(setDetails)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load organization.'))
      .finally(() => setLoading(false));
  }, [open, organizationId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-dvh max-h-dvh w-full max-w-full overflow-hidden p-0 md:h-auto md:max-h-[680px] md:max-w-[900px] lg:max-w-[1000px]">
        <DialogTitle className="sr-only">Organization settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize your organization settings here.
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
              <div className="hidden items-center gap-2 md:flex">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink href="#">
                        {details?.name ?? 'Organization settings'}
                      </BreadcrumbLink>
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
              {loading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : !details || organizationId === null ? null : (
                <>
                  {activeNav === 'General' && (
                    <GeneralPage
                      open={open}
                      organizationId={details.id}
                      initialName={details.name}
                      initialGitProvider={details.gitProvider}
                      onNameChange={nextName =>
                        setDetails(prev => (prev ? { ...prev, name: nextName } : prev))
                      }
                    />
                  )}
                  {activeNav === 'Members' && (
                    <MembersPage open={open} organizationId={details.id} />
                  )}
                  {activeNav === 'Feed' && (
                    <FeedPage
                      open={open}
                      organizationId={details.id}
                      initialRetentionDays={details.feedRetentionDays}
                    />
                  )}
                  {activeNav === 'Danger zone' && (
                    <DangerZonePage
                      organizationId={details.id}
                      organizationName={details.name}
                      onOpenChange={onOpenChange}
                    />
                  )}
                </>
              )}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
