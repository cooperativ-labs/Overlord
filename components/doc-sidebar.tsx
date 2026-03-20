'use client';

import { GalleryVerticalEnd } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail
} from '@/components/ui/sidebar';

const data = {
  navMain: [
    {
      title: 'Getting Started',
      url: '/docs',
      items: [
        {
          title: 'Introduction',
          url: '/docs'
        },
        {
          title: 'Quick Start',
          url: '/docs/quick-start'
        }
      ]
    },
    {
      title: 'Product Surfaces',
      url: '/docs/surfaces',
      items: [
        {
          title: 'Web App',
          url: '/docs/surfaces/web-app'
        },
        {
          title: 'Desktop App',
          url: '/docs/surfaces/desktop-app'
        },
        {
          title: 'CLI',
          url: '/docs/surfaces/cli'
        },
        {
          title: 'MCP Server',
          url: '/docs/surfaces/mcp-server'
        }
      ]
    },
    {
      title: 'Workflow',
      url: '/docs/workflow',
      items: [
        {
          title: 'Tickets',
          url: '/docs/workflow/tickets'
        },
        {
          title: 'Agent Execution',
          url: '/docs/workflow/agent-execution'
        },
        {
          title: 'Updates & Questions',
          url: '/docs/workflow/updates'
        },
        {
          title: 'Review & Delivery',
          url: '/docs/workflow/review'
        }
      ]
    },
    {
      title: 'Protocol Reference',
      url: '/docs/protocol',
      items: [
        {
          title: 'Attach',
          url: '/docs/protocol/attach'
        },
        {
          title: 'Update',
          url: '/docs/protocol/update'
        },
        {
          title: 'Ask',
          url: '/docs/protocol/ask'
        },
        {
          title: 'Deliver',
          url: '/docs/protocol/deliver'
        },
        {
          title: 'Context',
          url: '/docs/protocol/context'
        },
        {
          title: 'Artifacts',
          url: '/docs/protocol/artifacts'
        }
      ]
    },
    {
      title: 'Security',
      url: '/docs/security',
      items: [
        {
          title: 'Data Boundaries',
          url: '/docs/security/data-boundaries'
        },
        {
          title: 'Authentication',
          url: '/docs/security/authentication'
        }
      ]
    }
  ]
};

export function DocSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/docs">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <GalleryVerticalEnd className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Overlord</span>
                  <span className="text-xs">Documentation</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {data.navMain.map(section => (
              <SidebarMenuItem key={section.title}>
                <SidebarMenuButton asChild>
                  <Link href={section.url} className="font-medium">
                    {section.title}
                  </Link>
                </SidebarMenuButton>
                {section.items?.length ? (
                  <SidebarMenuSub>
                    {section.items.map(item => (
                      <SidebarMenuSubItem key={item.title}>
                        <SidebarMenuSubButton asChild isActive={pathname === item.url}>
                          <Link href={item.url}>{item.title}</Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
