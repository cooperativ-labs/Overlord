import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { TicketPanelContent } from '@/components/features/TicketPanelContent';
import { TicketPanelSkeleton } from '@/components/features/TicketPanelSkeleton';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SidePanelSlot } from '@/components/ui/side-panel';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { createClientForRequest } from '@/supabase/utils/server';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ projectId: string; ticketId: string }>;
};

export default async function TicketDetailLayout({ children, params }: LayoutProps) {
  const { projectId, ticketId } = await params;

  if (!projectId) {
    notFound();
  }

  const supabase = await createClientForRequest();
  const { data: project } = await supabase
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .single();

  if (!project) {
    notFound();
  }

  const closePath = buildProjectPath({ projectId });

  return (
    <>
      {children}
      <SidePanelSlot closePath={closePath}>
        <Suspense fallback={<TicketPanelSkeleton />}>
          <ErrorBoundary>
            <TicketPanelContent
              key={ticketId}
              ticketId={ticketId}
              organizationId={project.organization_id}
              closePath={closePath}
            />
          </ErrorBoundary>
        </Suspense>
      </SidePanelSlot>
    </>
  );
}
