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
  params: Promise<{ ticketId: string }>;
};

export default async function EditTicketPage({ params }: PageProps) {
  const { ticketId } = await params;
  const supabase = await createClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();

  if (error || !ticket) {
    notFound();
  }

  async function submit(formData: FormData) {
    'use server';

    await updateTicketAction(ticketId, formData);
    redirect(`/tickets/${ticketId}`);
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Edit Ticket</CardTitle>
            <Button asChild variant="ghost">
              <Link href={`/tickets/${ticketId}`}>Cancel</Link>
            </Button>
          </div>
          <CardDescription>
            Structured ticket fields are the source of truth for agent execution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input defaultValue={ticket.title} id="title" name="title" required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="objective">Objective</Label>
              <Textarea defaultValue={ticket.objective} id="objective" name="objective" required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="context">Context &amp; Reference Files</Label>
              <Textarea defaultValue={ticket.context ?? ''} id="context" name="context" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="constraints">Constraints</Label>
              <Textarea
                defaultValue={ticket.constraints ?? ''}
                id="constraints"
                name="constraints"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="availableTools">Available Tools</Label>
              <Textarea
                defaultValue={ticket.available_tools ?? ''}
                id="availableTools"
                name="availableTools"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="acceptanceCriteria">Acceptance Criteria</Label>
              <Textarea
                defaultValue={ticket.acceptance_criteria ?? ''}
                id="acceptanceCriteria"
                name="acceptanceCriteria"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="outputFormat">Output Format</Label>
              <Textarea
                defaultValue={ticket.output_format ?? ''}
                id="outputFormat"
                name="outputFormat"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="assignedAgent">Assigned Agent</Label>
                <Input
                  defaultValue={ticket.assigned_agent ?? ''}
                  id="assignedAgent"
                  name="assignedAgent"
                  placeholder="Claude Code"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="priority">Priority</Label>
                <select
                  defaultValue={ticket.priority}
                  id="priority"
                  name="priority"
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
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
