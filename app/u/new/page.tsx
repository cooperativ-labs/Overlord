import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { createTicketAction } from '@/lib/actions/tickets';

export default function NewTicketPage() {
  async function submit(formData: FormData) {
    'use server';

    const { id, organizationId } = await createTicketAction(formData);
    redirect(`/${organizationId}/${id}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="mb-2 text-sm font-medium text-muted-foreground">New ticket</p>
      <h1 className="mb-8 text-3xl font-bold tracking-tight">What needs to happen?</h1>

      <form action={submit} className="grid gap-8">
        <section>
          <Textarea
            autoFocus
            className="min-h-48 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
            id="description"
            name="description"
            placeholder="Describe the task. Dump your idea here — no title needed…"
            required
          />
        </section>

        <Separator />

        <section className="grid gap-6">
          <div className="grid gap-2">
            <Label
              className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              htmlFor="acceptanceCriteria"
            >
              Acceptance Criteria{' '}
              <span className="font-normal normal-case tracking-normal">— optional</span>
            </Label>
            <Textarea
              className="min-h-24 resize-none"
              id="acceptanceCriteria"
              name="acceptanceCriteria"
              placeholder="How will you know the agent is done?"
            />
          </div>

          <div className="grid gap-2">
            <Label
              className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              htmlFor="availableTools"
            >
              Available Tools{' '}
              <span className="font-normal normal-case tracking-normal">— optional</span>
            </Label>
            <Textarea
              className="min-h-20 resize-none"
              id="availableTools"
              name="availableTools"
              placeholder="e.g. web search, code execution, file access…"
            />
          </div>
        </section>

        <div className="flex justify-end">
          <Button type="submit">Create Ticket</Button>
        </div>
      </form>
    </div>
  );
}
