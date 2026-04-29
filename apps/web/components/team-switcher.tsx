'use client';

import { Check, ChevronsUpDown, Globe, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { CreateOrganizationModal } from '@/components/features/organizations/CreateOrganizationModal';
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

  const activeOrg = selectedOrgId ? organizations.find(o => o.id === selectedOrgId) : null;
  const activeLabel = activeOrg?.name ?? 'All Teams';

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
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Globe className="size-4" />
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
                      className="gap-2 p-2"
                    >
                      <div className="flex size-6 items-center justify-center rounded-md border">
                        <span className="text-xs font-semibold">
                          {org.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      {org.name}
                      {selectedOrgId === org.id && <Check className="ml-auto h-4 w-4" />}
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
    </>
  );
}
