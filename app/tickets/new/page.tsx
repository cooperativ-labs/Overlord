import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createTicketAction } from '@/lib/actions/tickets';

export default function NewTicketPage() {
  async function submit(formData: FormData) {
    'use server';

    const { id } = await createTicketAction(formData);
    redirect(`/tickets/${id}`);
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Create Ticket</CardTitle>
          <CardDescription>
            Structured ticket fields are the source of truth for agent execution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="objective">Objective</Label>
              <Textarea id="objective" name="objective" required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="context">Context &amp; Reference Files</Label>
              <Textarea id="context" name="context" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="constraints">Constraints</Label>
              <Textarea id="constraints" name="constraints" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="availableTools">Available Tools</Label>
              <Textarea id="availableTools" name="availableTools" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="acceptanceCriteria">Acceptance Criteria</Label>
              <Textarea id="acceptanceCriteria" name="acceptanceCriteria" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="outputFormat">Output Format</Label>
              <Textarea id="outputFormat" name="outputFormat" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="assignedAgent">Assigned Agent</Label>
                <Input id="assignedAgent" name="assignedAgent" placeholder="Claude Code" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="priority">Priority</Label>
                <select
                  defaultValue="medium"
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
              <Button type="submit">Save Ticket</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
