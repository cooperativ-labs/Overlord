'use client';

import { SidePanel, SidePanelProvider } from '@/components/ui/side-panel';

export function OrganizationShell({ children }: { children: React.ReactNode }) {
  return (
    <SidePanelProvider>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-x-auto">{children}</div>
        <SidePanel />
      </div>
    </SidePanelProvider>
  );
}
