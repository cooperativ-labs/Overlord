import TicketsBoardContent from '../tickets/(components)/TicketsBoardContent';

export default async function UserTicketsPage({
  searchParams
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = 'board' } = await searchParams;

  return (
    <TicketsBoardContent
      view={view}
      showOrganizationName
      title="Your Ticket Inbox"
      description="Tickets from organizations you can access."
    />
  );
}
