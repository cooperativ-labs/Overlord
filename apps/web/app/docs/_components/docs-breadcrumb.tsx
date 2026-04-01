'use client';

import { usePathname } from 'next/navigation';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';

const TITLES: Record<string, string> = {
  '/docs': 'Introduction',
  '/docs/quick-start': 'Quick Start',
  '/docs/surfaces': 'Product Surfaces',
  '/docs/surfaces/web-app': 'Web App',
  '/docs/surfaces/desktop-app': 'Desktop App',
  '/docs/surfaces/cli': 'CLI',
  '/docs/surfaces/mcp-server': 'MCP Server',
  '/docs/workflow': 'Workflow',
  '/docs/workflow/tickets': 'Tickets',
  '/docs/workflow/agent-execution': 'Agent Execution',
  '/docs/workflow/updates': 'Updates & Questions',
  '/docs/workflow/review': 'Review & Delivery',
  '/docs/protocol': 'Protocol Reference',
  '/docs/protocol/attach': 'Attach',
  '/docs/protocol/update': 'Update',
  '/docs/protocol/ask': 'Ask',
  '/docs/protocol/deliver': 'Deliver',
  '/docs/protocol/context': 'Context',
  '/docs/protocol/artifacts': 'Artifacts',
  '/docs/security': 'Security',
  '/docs/security/data-boundaries': 'Data Boundaries',
  '/docs/security/authentication': 'Authentication'
};

export function DocsBreadcrumb() {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? 'Introduction';

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/docs">Documentation</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
