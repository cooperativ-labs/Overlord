'use client';

import { ChevronDown, ChevronRight, FileCode2, MessageSquare, Terminal, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type TranscriptEvent = Database['public']['Tables']['agent_transcript_events']['Row'];
type RationaleDraft = Database['public']['Tables']['change_rationale_drafts']['Row'];

const eventKindIcon: Record<string, React.ReactNode> = {
  file_edit: <FileCode2 className="h-3.5 w-3.5" />,
  tool_use: <Terminal className="h-3.5 w-3.5" />,
  commentary: <MessageSquare className="h-3.5 w-3.5" />
};

const confidenceColors: Record<string, string> = {
  high: 'bg-green-500/15 text-green-700 dark:text-green-400',
  medium: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  low: 'bg-red-500/15 text-red-700 dark:text-red-400'
};

function RelativeTime({ timestamp }: { timestamp: string }) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return <span>just now</span>;
  if (diffMin < 60) return <span>{diffMin}m ago</span>;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return <span>{diffHr}h ago</span>;
  return <span>{date.toLocaleDateString()}</span>;
}

export function TranscriptDebugSection({ ticketId }: { ticketId: string }) {
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [drafts, setDrafts] = useState<RationaleDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const [eventsResult, draftsResult] = await Promise.all([
        supabase
          .from('agent_transcript_events')
          .select('*')
          .eq('ticket_id', ticketId)
          .eq('high_signal', true)
          .order('event_time', { ascending: false })
          .limit(50),
        supabase
          .from('change_rationale_drafts')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: false })
          .limit(50)
      ]);

      setEvents(eventsResult.data ?? []);
      setDrafts(draftsResult.data ?? []);
      setLoading(false);
    }

    load();
  }, [ticketId]);

  const totalCount = events.length + drafts.length;

  if (loading) {
    return (
      <div className="mt-4 rounded-lg border border-dashed p-4">
        <p className="text-xs text-muted-foreground animate-pulse">Loading transcript data...</p>
      </div>
    );
  }

  if (totalCount === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-4">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Zap className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-medium">Transcript Debug</span>
          <Badge variant="secondary" className="ml-auto text-[10px] rounded-full">
            {events.length} events / {drafts.length} drafts
          </Badge>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 space-y-4">
        {/* High-signal events */}
        {events.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground px-1">
              High-Signal Events
            </h4>
            <div className="rounded-md border divide-y max-h-80 overflow-y-auto">
              {events.map(event => (
                <div key={event.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-muted-foreground">
                      {eventKindIcon[event.event_kind] ?? (
                        <Zap className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] rounded-full px-1.5 py-0"
                    >
                      {event.event_kind}
                    </Badge>
                    {event.tool_name && (
                      <code className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                        {event.tool_name}
                      </code>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      <RelativeTime timestamp={event.event_time} />
                    </span>
                  </div>
                  {event.file_path && (
                    <p className="text-[11px] font-mono text-blue-600 dark:text-blue-400 mb-0.5">
                      {event.file_path}
                    </p>
                  )}
                  {event.summary && (
                    <p className="text-muted-foreground line-clamp-2">{event.summary}</p>
                  )}
                  {event.command_preview && (
                    <pre className="mt-1 text-[10px] bg-muted rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">
                      {event.command_preview}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Draft rationales */}
        {drafts.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground px-1">
              Draft Change Rationales
            </h4>
            <div className="rounded-md border divide-y max-h-80 overflow-y-auto">
              {drafts.map(draft => (
                <div key={draft.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{draft.label}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] rounded-full px-1.5 py-0',
                        confidenceColors[draft.confidence]
                      )}
                    >
                      {draft.confidence}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] rounded-full px-1.5 py-0">
                      {draft.change_kind}
                    </Badge>
                  </div>
                  <p className="text-[11px] font-mono text-blue-600 dark:text-blue-400 mb-0.5">
                    {draft.file_path}
                  </p>
                  <p className="text-muted-foreground mb-1">{draft.summary}</p>
                  <div className="mt-1 rounded bg-muted/50 px-2 py-1.5 space-y-1">
                    <p className="text-[10px]">
                      <span className="font-medium text-foreground">Why: </span>
                      <span className="text-muted-foreground">{draft.why}</span>
                    </p>
                    <p className="text-[10px]">
                      <span className="font-medium text-foreground">Impact: </span>
                      <span className="text-muted-foreground">{draft.impact}</span>
                    </p>
                    <p className="text-[10px]">
                      <span className="font-medium text-foreground">Source: </span>
                      <span className="text-muted-foreground">{draft.attribution_source}</span>
                    </p>
                  </div>
                  {Array.isArray(draft.evidence) && (draft.evidence as Array<Record<string, unknown>>).length > 0 && (
                    <details className="mt-1.5">
                      <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                        Evidence ({(draft.evidence as Array<Record<string, unknown>>).length} entries)
                      </summary>
                      <div className="mt-1 space-y-1">
                        {(draft.evidence as Array<Record<string, string | number | null>>).map(
                          (ev, i) => (
                            <div
                              key={i}
                              className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground"
                            >
                              <span className="font-mono">
                                {ev.tool_name ?? ev.event_kind}
                              </span>
                              {ev.summary && (
                                <span className="ml-1.5">{String(ev.summary).slice(0, 120)}</span>
                              )}
                              {ev.score != null && (
                                <Badge
                                  variant="outline"
                                  className="ml-1.5 text-[9px] rounded-full px-1 py-0"
                                >
                                  score: {ev.score}
                                </Badge>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
