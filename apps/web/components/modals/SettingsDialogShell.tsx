'use client';

import { X } from 'lucide-react';

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

export type SettingsNavItem = {
  name: string;
  icon: React.ElementType;
  electronOnly?: boolean;
};

export type SettingsNavGroup = {
  label?: string;
  items: SettingsNavItem[];
};

type SettingsDialogShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Screen-reader dialog title. */
  title: string;
  /** Screen-reader dialog description. */
  description: string;
  /** Desktop breadcrumb root label. Defaults to `title`. */
  breadcrumbRoot?: string;
  navGroups: SettingsNavGroup[];
  activeNav: string;
  onActiveNavChange: (name: string) => void;
  /** Render the header close (X) button. */
  showClose?: boolean;
  /** The active settings page. */
  children: React.ReactNode;
};

/**
 * Shared chrome for the settings-style dialogs (Settings, Project settings,
 * Organization settings): the sized `DialogContent`, the desktop sidebar nav,
 * the mobile select / desktop breadcrumb header, and the scrollable body.
 *
 * Callers own the nav configuration (including any `electronOnly` filtering)
 * and the page switch passed as `children`, keeping this component dumb.
 */
export function SettingsDialogShell({
  open,
  onOpenChange,
  title,
  description,
  breadcrumbRoot,
  navGroups,
  activeNav,
  onActiveNavChange,
  showClose = false,
  children
}: SettingsDialogShellProps) {
  const flatNavItems = navGroups.flatMap(group => group.items);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-dvh max-h-dvh w-full max-w-full overflow-hidden p-0 md:h-auto md:max-h-[80%] md:max-w-[900px] lg:max-w-[1000px]">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex md:w-52">
            <SidebarContent>
              {navGroups.map((group, index) => (
                <SidebarGroup key={group.label ?? `group-${index}`}>
                  {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map(item => (
                        <SidebarMenuItem key={item.name}>
                          <SidebarMenuButton
                            isActive={item.name === activeNav}
                            onClick={() => onActiveNavChange(item.name)}
                          >
                            <item.icon />
                            <span>{item.name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>
          </Sidebar>
          <main className="flex h-dvh flex-1 flex-col overflow-hidden md:max-h-[80%]">
            <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
              {/* Mobile: page selector dropdown */}
              <div className="flex w-full items-center md:hidden">
                <Select value={activeNav} onValueChange={onActiveNavChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {flatNavItems.map(item => (
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
                      <BreadcrumbLink href="#">{breadcrumbRoot ?? title}</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeNav}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              {showClose ? (
                <DialogClose className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <X className="size-5" />
                  <span className="sr-only">Close settings</span>
                </DialogClose>
              ) : null}
            </header>
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">{children}</div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
