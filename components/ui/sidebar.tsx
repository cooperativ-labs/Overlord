'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeft } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

type SidebarContextValue = {
  isMobile: boolean;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

const SIDEBAR_WIDTH = '16rem';
const SIDEBAR_WIDTH_ICON = '3rem';

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

function SidebarProvider({
  defaultOpen = true,
  children
}: React.ComponentProps<'div'> & { defaultOpen?: boolean }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <SidebarContext.Provider value={{ isMobile, open, setOpen }}>
      <div
        style={
          {
            '--sidebar-width': SIDEBAR_WIDTH,
            '--sidebar-width-icon': SIDEBAR_WIDTH_ICON
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider.');
  }
  return context;
}

function SidebarInset({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-sidebar="inset"
      className={cn(
        'bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        className
      )}
      {...props}
    />
  );
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<'button'>) {
  const { setOpen } = useSidebar();

  return (
    <button
      type="button"
      data-sidebar="trigger"
      className={cn(
        'hover:bg-accent hover:text-accent-foreground inline-flex size-8 items-center justify-center rounded-md border border-transparent outline-none transition-colors',
        className
      )}
      onClick={event => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setOpen(previous => !previous);
        }
      }}
      {...props}
    >
      <PanelLeft className="size-4" />
      <span className="sr-only">Toggle Sidebar</span>
    </button>
  );
}

function Sidebar({
  className,
  collapsible = 'icon',
  style,
  ...props
}: React.ComponentProps<'div'> & {
  collapsible?: 'icon' | 'none';
}) {
  const { open } = useSidebar();

  const computedStyle =
    collapsible === 'icon'
      ? {
          width: open ? 'var(--sidebar-width)' : 'var(--sidebar-width-icon)',
          ...style
        }
      : style;

  return (
    <aside
      data-sidebar="sidebar"
      data-collapsible={collapsible === 'icon' ? (open ? '' : 'icon') : 'none'}
      className={cn(
        'bg-sidebar text-sidebar-foreground flex h-dvh shrink-0 border-sidebar-border',
        collapsible === 'icon' && 'border-r transition-[width] duration-200 ease-linear',
        className
      )}
      style={computedStyle}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-sidebar="header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-sidebar="footer" className={cn('mt-auto p-2', className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-sidebar="content"
      className={cn('flex flex-1 flex-col overflow-auto', className)}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-sidebar="group" className={cn('p-2', className)} {...props} />;
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-sidebar="group-content" className={cn('grid gap-1', className)} {...props} />;
}

function SidebarInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-sidebar="input"
      className={cn(
        'border-sidebar-border bg-background flex h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50',
        className
      )}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-sidebar="menu" className={cn('grid gap-1', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-sidebar="menu-item" className={cn('group/menu-item', className)} {...props} />;
}

const sidebarMenuButtonVariants = cva(
  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-left text-sm outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      size: {
        default: 'h-9',
        lg: 'h-10'
      },
      isActive: {
        true: 'bg-sidebar-accent text-sidebar-accent-foreground',
        false: ''
      }
    },
    defaultVariants: {
      size: 'default',
      isActive: false
    }
  }
);

function SidebarMenuButton({
  asChild,
  className,
  size,
  isActive,
  tooltip: _tooltip,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof sidebarMenuButtonVariants> & {
    asChild?: boolean;
    tooltip?: { children: React.ReactNode; hidden?: boolean };
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-sidebar="menu-button"
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ size, isActive, className }))}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar
};
