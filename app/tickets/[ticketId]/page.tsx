import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { updateTicketStatusAction } from '@/lib/actions/tickets';
import { createClient } from '@/supabase/utils/server';

const statuses = [
  'draft',
  'review',
  'refine',
  'execute',
  'deliver',
  'complete',
  'blocked'
] as const;

type PageProps = {
  params: Promise<{ ticketId: string }>;
};

function buildAttachCommand(ticketNumber: string | null) {
  return `orchestrator attach ${ticketNumber ?? 'TICKET-XXXX'}`;
}

export default async function TicketDetailPage({ params }: PageProps) {
  const { ticketId } = await params;
  const supabase = await createClient();

  const [
    { data: ticket, error: ticketError },
    { data: events },
    { data: state },
    { data: artifacts }
  ] = await Promise.all([
    supabase.from('tickets').select('*').eq('id', ticketId).single(),
    supabase
      .from('ticket_events')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('shared_state')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('artifacts')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(20)
  ]);

  if (ticketError || !ticket) {
    notFound();
  }

  async function transition(formData: FormData) {
    'use server';

    const nextStatus = String(formData.get('status') ?? '');
    await updateTicketStatusAction(ticketId, nextStatus);
  }

  const attachCommand = buildAttachCommand(ticket.ticket_number);
  const chatGptLink = `https://chat.openai.com/?q=${encodeURIComponent(`attach ${ticket.ticket_number ?? ''}`)}`;

  return (
    <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
      <section className="grid gap-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle>
                {ticket.ticket_number} - {ticket.title}
              </CardTitle>
              <Button asChild variant="ghost">
                <Link href={`/tickets/${ticketId}/edit`}>Edit Ticket</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{ticket.status}</Badge>
              <Badge>priority {ticket.priority}</Badge>
              {ticket.assigned_agent ? (
                <Badge variant="secondary">{ticket.assigned_agent}</Badge>
              ) : null}
            </div>

            <div className="grid gap-3 text-sm">
              <div className="grid gap-1">
                <strong>Objective</strong>
                <span className="text-muted-foreground">{ticket.objective}</span>
              </div>
              <Separator />
              <div className="grid gap-1">
                <strong>Context</strong>
                <span className="text-muted-foreground">{ticket.context || 'None provided.'}</span>
              </div>
              <Separator />
              <div className="grid gap-1">
                <strong>Constraints</strong>
                <span className="text-muted-foreground">
                  {ticket.constraints || 'None provided.'}
                </span>
              </div>
              <Separator />
              <div className="grid gap-1">
                <strong>Available Tools</strong>
                <span className="text-muted-foreground">
                  {ticket.available_tools || 'None provided.'}
                </span>
              </div>
              <Separator />
              <div className="grid gap-1">
                <strong>Acceptance Criteria</strong>
                <span className="text-muted-foreground">
                  {ticket.acceptance_criteria || 'None provided.'}
                </span>
              </div>
              <Separator />
              <div className="grid gap-1">
                <strong>Output Format</strong>
                <span className="text-muted-foreground">
                  {ticket.output_format || 'None provided.'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ticket Events</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {events?.length ? null : (
              <Alert>
                <AlertDescription>No events yet.</AlertDescription>
              </Alert>
            )}
            {events?.map(event => (
              <article className="grid gap-2 rounded-lg border p-3" key={event.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{event.event_type}</Badge>
                  {event.phase ? <Badge variant="secondary">{event.phase}</Badge> : null}
                  <span className="text-muted-foreground text-xs">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm">{event.summary || 'No summary provided.'}</p>
              </article>
            ))}
          </CardContent>
        </Card>
      </section>

      <aside className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={transition} className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="status">Set Status</Label>
                <select
                  defaultValue={ticket.status}
                  id="status"
                  name="status"
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  {statuses.map(status => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Update Status</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open In...</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="grid gap-1">
              <strong>Terminal / Claude Code</strong>
              <code className="rounded border bg-muted px-2 py-1">{attachCommand}</code>
            </div>
            <div className="grid gap-1">
              <strong>Claude App</strong>
              <code className="rounded border bg-muted px-2 py-1">{`Attach to ${ticket.ticket_number}`}</code>
            </div>
            <div className="grid gap-1">
              <strong>ChatGPT</strong>
              <Button asChild variant="outline">
                <a href={chatGptLink} rel="noreferrer" target="_blank">
                  Open prefilled attach prompt
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shared State</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {state?.length ? null : (
              <Alert>
                <AlertDescription>No shared state entries yet.</AlertDescription>
              </Alert>
            )}
            {state?.map(item => (
              <div className="grid gap-1 rounded-md border p-3" key={item.id}>
                <strong>{item.state_key}</strong>
                <code className="max-h-40 overflow-auto rounded border bg-muted p-2 text-xs">
                  {JSON.stringify(item.state_value, null, 2)}
                </code>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {artifacts?.length ? null : (
              <Alert>
                <AlertDescription>No artifacts delivered yet.</AlertDescription>
              </Alert>
            )}
            {artifacts?.map(artifact => (
              <div className="grid gap-1 rounded-md border p-3" key={artifact.id}>
                <strong>{artifact.label}</strong>
                <span className="text-muted-foreground">{artifact.artifact_type}</span>
                {artifact.uri ? (
                  <a
                    className="text-primary underline-offset-4 hover:underline"
                    href={artifact.uri}
                  >
                    {artifact.uri}
                  </a>
                ) : null}
                {artifact.content ? (
                  <code className="max-h-40 overflow-auto rounded border bg-muted p-2 text-xs">
                    {artifact.content}
                  </code>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
