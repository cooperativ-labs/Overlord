import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updateTicketAction } from '@/lib/actions/tickets';
import { createClient } from '@/supabase/utils/server';

type PageProps = {
  params: Promise<{ organizationId: string; ticketId: string }>;
};

export default async function EditTicketPage({ params }: PageProps) {
  const { organizationId, ticketId } = await params;
  const parsedOrganizationId = Number(organizationId);

  if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId <= 0) {
    notFound();
  }

  const supabase = await createClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .eq('organization_id', parsedOrganizationId)
    .single();

  if (error || !ticket) {
    notFound();
  }

  async function submit(formData: FormData) {
    'use server';

    await updateTicketAction(ticketId, formData);
    redirect(`/${parsedOrganizationId}/${ticketId}`);
  }

  return (
    <div className="grid gap-4">
      <div>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/${parsedOrganizationId}`}>{'← Back to board'}</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Edit Ticket</CardTitle>
            <Button asChild variant="ghost">
              <Link href={`/${parsedOrganizationId}/${ticketId}`}>Cancel</Link>
            </Button>
          </div>
          <CardDescription>Describe the task for the agent to work on.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="title">
                Title{' '}
                <span className="text-muted-foreground font-normal">
                  (optional — leave blank to use description preview)
                </span>
              </Label>
              <Input defaultValue={ticket.title ?? ''} id="title" name="title" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                className="min-h-40"
                defaultValue={ticket.objective ?? ''}
                id="description"
                name="description"
                placeholder="Describe what the agent should do, including any context and constraints..."
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="availableTools">
                Available Tools{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                defaultValue={ticket.available_tools ?? ''}
                id="availableTools"
                name="availableTools"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="acceptanceCriteria">
                Acceptance Criteria{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                defaultValue={ticket.acceptance_criteria ?? ''}
                id="acceptanceCriteria"
                name="acceptanceCriteria"
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit">Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
