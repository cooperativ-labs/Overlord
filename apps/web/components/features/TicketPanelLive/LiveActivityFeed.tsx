'use client';

import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Eye,
  HelpCircle,
  type LucideIcon,
  Package,
  Paperclip,
  PenLine,
  RotateCcw,
  Zap
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  getEventDisplaySummary,
  getEventPayload,
  isUserFollowUpEvent
} from '@/lib/overlord/conversation';
import { cn } from '@/lib/utils';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'name' | 'image_url'>;

const EVENT_ICONS: Partial<Record<Database['public']['Enums']['ticket_event_type'], LucideIcon>> = {
  update: Activity,
  question: HelpCircle,
  answer: CheckCircle2,
  deliver: Package,
  artifact: Paperclip,
  status_change: ArrowRightLeft,
  alert: AlertCircle,
  context_write: PenLine,
  context_read: Eye,
  ticket_reopened: RotateCcw
};

const EVENT_LABELS: Partial<Record<Database['public']['Enums']['ticket_event_type'], string>> = {
  update: 'Update',
  question: 'Question',
  answer: 'Answer',
  deliver: 'Delivered',
  artifact: 'Artifact',
  status_change: 'Status Changed',
  alert: 'Notification',
  user_follow_up: 'Follow-up',
  context_write: 'Context Written',
  context_read: 'Context Read',
  ticket_reopened: 'Reopened'
};

function getDisplayLabel(event: TicketEvent): string {
  return EVENT_LABELS[event.event_type] ?? event.event_type;
}

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
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  useEffect(() => {
    const userIds = [
      ...new Set(
        events.filter(e => isUserFollowUpEvent(e) && e.created_by).map(e => e.created_by as string)
      )
    ];
    if (userIds.length === 0) return;

    const supabase = createClient();
    void supabase
      .from('profiles')
      .select('id, name, image_url')
      .in('id', userIds)
      .then(({ data }) => {
        if (!data) return;
        setProfiles(prev => {
          const next = { ...prev };
          for (const p of data) next[p.id] = p;
          return next;
        });
      });
  }, [events]);

  if (!visibleEvents.length) {
    return <p className="text-sm italic text-muted-foreground">No events yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {visibleEvents.map(event => {
        const isUserFollowUp = isUserFollowUpEvent(event);
        const isHookCaptured =
          isUserFollowUp && getEventPayload(event).hook_type === 'UserPromptSubmit';
        const summary = getEventDisplaySummary(event);
        const profile = isUserFollowUp && event.created_by ? profiles[event.created_by] : null;
        const Icon = EVENT_ICONS[event.event_type];

        return (
          <article className="flex gap-3" key={event.id}>
            <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center">
              {isUserFollowUp ? (
                <Avatar className="h-5 w-5">
                  {profile?.image_url ? (
                    <AvatarImage src={profile.image_url} alt={profile.name ?? ''} />
                  ) : null}
                  <AvatarFallback className="text-[9px]">
                    {(profile?.name ?? 'U').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : Icon ? (
                <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
              )}
            </div>
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'text-xs font-medium',
                    isUserFollowUp ? 'text-sky-700 dark:text-sky-400' : 'text-foreground/80'
                  )}
                >
                  {isUserFollowUp && profile?.name ? profile.name : getDisplayLabel(event)}
                </span>
                {event.phase ? (
                  <Badge className="h-5 rounded-full px-2 text-xs" variant="secondary">
                    {event.phase}
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {new Date(event.created_at).toLocaleString()}
                </span>
                {isHookCaptured ? (
                  <Zap
                    aria-label="Captured automatically by hook"
                    className="h-3 w-3 text-muted-foreground/60"
                    name="Captured automatically by hook"
                  />
                ) : null}
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
