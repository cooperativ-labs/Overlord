'use client';

import { MessageSquare } from 'lucide-react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Badge } from '@/components/ui/badge';
import {
  getEventDisplayLabel,
  getEventDisplaySummary,
  isUserFollowUpEvent
} from '@/lib/overlord/conversation';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

export function LiveActivityFeed({
  editorScheme,
  events,
  workspaceRoot
}: {
  editorScheme?: string | null;
  events: TicketEvent[];
  workspaceRoot?: string | null;
}) {
  const visibleEvents = events.filter(event => event.event_type !== 'system');

  if (!visibleEvents.length) {
    return <p className="text-sm italic text-muted-foreground">No events yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {visibleEvents.map(event => {
        const isUserFollowUp = isUserFollowUpEvent(event);
        const summary = getEventDisplaySummary(event);

        return (
          <article className="flex gap-3" key={event.id}>
            <div
              className={cn(
                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                isUserFollowUp ? 'bg-sky-500/80' : 'bg-muted-foreground/30'
              )}
            />
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-xs font-medium',
                    isUserFollowUp && 'text-sky-700 dark:text-sky-400'
                  )}
                >
                  {isUserFollowUp ? <MessageSquare className="h-3.5 w-3.5" /> : null}
                  {getEventDisplayLabel(event)}
                </span>
                {event.phase ? (
                  <Badge className="h-5 rounded-full px-2 text-xs" variant="secondary">
                    {event.phase}
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {new Date(event.created_at).toLocaleString()}
                </span>
              </div>
              {summary ? (
                <MarkdownContent
                  compact
                  className={cn(
                    'text-sm',
                    isUserFollowUp
                      ? [
                          'text-sky-700 dark:text-sky-300',
                          'prose-p:text-sky-700 dark:prose-p:text-sky-300',
                          'prose-li:text-sky-700 dark:prose-li:text-sky-300',
                          'prose-strong:text-sky-800 dark:prose-strong:text-sky-200',
                          'prose-code:text-sky-800 dark:prose-code:text-sky-200'
                        ]
                      : 'text-muted-foreground'
                  )}
                  editorScheme={editorScheme}
                  workspaceRoot={workspaceRoot}
                >
                  {summary}
                </MarkdownContent>
              ) : (
                <p className="text-sm italic text-muted-foreground">No summary.</p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
