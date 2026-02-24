import TicketsBoardContent from '../../../tickets/(components)/TicketsBoardContent';

type PageProps = {
  params: Promise<{ organizationId: string; projectId: string }>;
  searchParams: Promise<{ view?: string }>;
};

export default async function ProjectTicketsPage({ params, searchParams }: PageProps) {
  const { organizationId, projectId } = await params;
  const { view = 'board' } = await searchParams;

  return (
    <TicketsBoardContent
      view={view}
      organizationId={Number(organizationId)}
      projectId={projectId}
    />
  );
}
