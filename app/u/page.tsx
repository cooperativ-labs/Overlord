import TicketsBoardContent from '../tickets/(components)/TicketsBoardContent';

export default async function UserTicketsPage() {
  return (
    <TicketsBoardContent
      showOrganizationName
      title="Your Ticket Inbox"
      description="Tickets from organizations you can access."
    />
  );
}
