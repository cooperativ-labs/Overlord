import { redirect } from 'next/navigation';

type LayoutProps = {
  params: Promise<{ projectId: string; ticketId: string }>;
};

export default async function OldTicketDetailLayout({ params }: LayoutProps) {
  const { projectId, ticketId } = await params;
  redirect(`/projects/${projectId}/${ticketId}`);
}
