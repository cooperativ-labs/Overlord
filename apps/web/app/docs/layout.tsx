import type { Metadata } from 'next';

import { DocSidebar } from '@/components/doc-sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

import { DocsBreadcrumb } from './_components/docs-breadcrumb';
import type { DocsNavData } from './_components/docs-nav';

export const metadata: Metadata = {
  title: {
    default: 'Overlord Docs',
    template: '%s | Overlord Docs'
  },
  description:
    'Learn the Overlord workflow, product surfaces, and how to get from a ticket to reviewed agent work.'
};

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
        },
        {
          title: 'Agent Plugins',
          url: '/docs/agent-plugins'
        }
      ]
    },
    {
      title: 'For Agents',
      url: '/docs/for-agents',
      items: [
        {
          title: 'Overview',
          url: '/docs/for-agents'
        },
        {
          title: 'Ticket Lifecycle',
          url: '/docs/for-agents/lifecycle'
        },
        {
          title: 'CLI Reference',
          url: '/docs/for-agents/cli-reference'
        },
        {
          title: 'Context & Artifacts',
          url: '/docs/for-agents/context-and-artifacts'
        },
        {
          title: 'Rules for Agents',
          url: '/docs/for-agents/rules'
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
      title: 'Integrations',
      url: '/docs/integrations',
      items: [
        {
          title: 'Overview',
          url: '/docs/integrations'
        },
        {
          title: 'Everhour',
          url: '/docs/integrations/everhour'
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
} satisfies DocsNavData;

export default function DocsLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SidebarProvider>
        <DocSidebar pages={data} />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b">
            <div className="flex items-center gap-2 px-3">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <DocsBreadcrumb />
            </div>
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  );
}
