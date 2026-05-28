'use client';

import { Check, ChevronsUpDown, Globe, Plus, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { CreateOrganizationModal } from '@/components/features/organizations/CreateOrganizationModal';
import { OrganizationSettingsModal } from '@/components/modals/OrganizationSettingsModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@/components/ui/sidebar';
import type { UserOrganization } from '@/lib/actions/organizations';
import { setSelectedOrgAction } from '@/lib/actions/organizations';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { refreshElectronRoute } from '@/lib/electron-auth/route-refresh';

const setSelectedOrgActionWithRetry = withElectronActionRetry(setSelectedOrgAction);

export function TeamSwitcher({
  organizations,
  selectedOrgId
}: {
  organizations: UserOrganization[];
  selectedOrgId: number | null;
}) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [createModalOpen, setCreateModalOpen] = React.useState(false);
  const [settingsOrgId, setSettingsOrgId] = React.useState<number | null>(null);

  const activeOrg = selectedOrgId ? organizations.find(o => o.id === selectedOrgId) : null;
  const activeLabel = activeOrg?.name ?? 'All Teams';

  function openOrgSettings(orgId: number, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setSettingsOrgId(orgId);
  }

  async function handleSelect(orgId: number | null) {
    await setSelectedOrgActionWithRetry(orgId);
    await refreshElectronRoute(router);
  }

  async function handleOrganizationCreated(organizationId: number) {
    await setSelectedOrgActionWithRetry(organizationId);
    router.refresh();
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="bg-muted dark:bg-muted-foreground/40 text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden">
                  {activeOrg?.logo_url ? (
                    <img
                      src={activeOrg.logo_url}
                      alt={activeOrg.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <Globe className="size-4" />
                  )}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{activeLabel}</span>
                  <span className="truncate text-xs">
                    {activeOrg ? 'Team workspace' : 'All workspaces'}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              align="start"
              side={isMobile ? 'bottom' : 'right'}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                Workspace
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleSelect(null)} className="gap-2 p-2">
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <Globe className="size-3.5 shrink-0" />
                </div>
                All Teams
                {selectedOrgId === null && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              {organizations.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  {organizations.map(org => (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={() => handleSelect(org.id)}
                      className="group gap-2 p-2"
                    >
                      <div className="flex size-6 items-center justify-center rounded-md border overflow-hidden">
                        {org.logo_url ? (
                          <img
                            src={org.logo_url}
                            alt={org.name}
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="text-xs font-medium">
                            {org.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span className="flex-1 truncate">{org.name}</span>
                      {selectedOrgId === org.id && <Check className="h-4 w-4" />}
                      <button
                        type="button"
                        aria-label={`Settings for ${org.name}`}
                        title="Workspace settings"
                        className="ml-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                        onClick={event => openOrgSettings(org.id, event)}
                      >
                        <Settings className="size-3.5" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateModalOpen(true)} className="gap-2 p-2">
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <Plus className="size-3.5 shrink-0" />
                </div>
                Create organization
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <CreateOrganizationModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onCreated={organizationId => void handleOrganizationCreated(organizationId)}
      />

      <OrganizationSettingsModal
        open={settingsOrgId !== null}
        onOpenChange={open => {
          if (!open) setSettingsOrgId(null);
        }}
        organizationId={settingsOrgId}
      />
    </>
  );
}
