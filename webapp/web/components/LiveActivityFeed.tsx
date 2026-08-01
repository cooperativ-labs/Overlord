import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  FileText,
  HelpCircle,
  type LucideIcon,
  MessageSquare,
  Rocket,
  ShieldQuestion
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AuthenticatedAvatarImage, Avatar, AvatarFallback } from '@/components/ui/avatar';

import type { MissionEventDto, MissionEventType } from '../../shared/contract.ts';
import { groupMissionFeedItems } from '../lib/mission-feed.ts';
import { useMissionEvents } from '../lib/queries.ts';

import {
  AgentSessionFeedCard,
  useAgentSessionFeed
} from './agent-session/AgentSessionActivity.tsx';
import { SessionChannelHealthCard } from './agent-session/SessionChannelHealthCard.tsx';
import { Markdown } from './Markdown.tsx';
import { Badge, Spinner } from './ui.tsx';

/**
 * Icon + human label for each `mission_events.type` value. Unknown (future)
 * types fall back to a neutral dot and the raw type string so the feed never
 * breaks when the server vocabulary grows ahead of the client.
 */
const EVENT_META: Record<MissionEventType, { icon: LucideIcon; label: string }> = {
  update: { icon: Activity, label: 'Update' },
  user_follow_up: { icon: MessageSquare, label: 'Follow-up' },
  alert: { icon: AlertCircle, label: 'Alert' },
  discussion_summary: { icon: FileText, label: 'Discussion' },
  decision: { icon: CheckCircle2, label: 'Decision' },
  ask: { icon: HelpCircle, label: 'Question' },
  permission_request: { icon: ShieldQuestion, label: 'Permission' },
  delivery: { icon: Activity, label: 'Delivered' },
  execution_requested: { icon: Rocket, label: 'Launch requested' },
  awaiting_approval: { icon: HelpCircle, label: 'Awaiting approval' },
  status_change: { icon: ArrowRightLeft, label: 'Status changed' }
};

function eventMeta(type: string): { icon: LucideIcon | null; label: string } {
  return EVENT_META[type as MissionEventType] ?? { icon: null, label: type.replace(/_/g, ' ') };
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function actorLabel(event: MissionEventDto): string {
  return event.actor?.displayName?.trim() || event.actor?.handle || 'User';
}

function actorInitials(label: string): string {
  return (
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase() || 'U'
  );
}

/**
 * Collapsed summary preview: plain text clamped to four lines with an optional
 * "Show more" hint when the content overflows. The summary itself is always
 * clickable to expand into richer detail.
 */
function ClampedSummaryPreview({
  text,
  tone,
  onExpand
}: {
  text: string;
  tone: string;
  onExpand: () => void;
}) {
  const measureRef = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    // Compare full content height against the collapsed (clamped) height to
    // decide whether the summary is long enough to warrant an expand hint.
    setIsClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div className="grid gap-0.5">
      <p
        ref={measureRef}
        onClick={onExpand}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onExpand();
          }
        }}
        className={`line-clamp-4 cursor-pointer whitespace-pre-wrap wrap-anywhere text-sm ${tone}`}
      >
        {text}
      </p>
      {isClamped ? (
        <span className="justify-self-start text-[11px] font-medium text-sky-600 dark:text-sky-400">
          Show more
        </span>
      ) : null}
    </div>
  );
}

/**
 * Renders an event summary. By default the text is shown clamped and *plain*
 * (no markdown formatting) so the feed stays clean and visually consistent
 * regardless of how each summary was authored. Clicking the summary lifts it
 * into a "detail" card — white/black background, `rounded-sm`, `shadow-md` —
 * where the markdown in the text is actually rendered with formatting.
 * Clicking anywhere outside the card returns it to the default plain state.
 */
function ExpandableSummary({ text, tone }: { text: string; tone: string }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  // Collapse back to the default state when the user clicks/taps outside the
  // expanded detail card, or presses Escape.
  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  if (expanded) {
    return (
      <div
        ref={cardRef}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(false);
          }
        }}
        className="cursor-pointer rounded-sm bg-white p-3 shadow-md dark:bg-black"
      >
        <Markdown text={text} />
      </div>
    );
  }

  return <ClampedSummaryPreview text={text} tone={tone} onExpand={() => setExpanded(true)} />;
}

function ActivityEntry({
  event,
  missionId,
  compact = false
}: {
  event: MissionEventDto;
  missionId: string;
  /** Nested row inside an expanded execution-status section. */
  compact?: boolean;
}) {
  const { icon: Icon, label } = eventMeta(event.type);
  const isUserFollowUp = event.type === 'user_follow_up';
  // Blocking questions posted via `ovld protocol ask` land as `ask` events. Give
  // them a subtle amber/orange outline + wash so they stand out as needing a reply.
  const isBlockingQuestion = event.type === 'ask';
  const userLabel = actorLabel(event);

  return (
    <article
      className={
        isBlockingQuestion
          ? 'flex min-w-0 gap-3 rounded-md border border-amber-400/50 bg-amber-50/60 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-500/10'
          : compact
            ? 'flex min-w-0 gap-3 py-1'
            : 'flex min-w-0 gap-3'
      }
    >
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
        {isUserFollowUp && event.actor ? (
          <Avatar size="sm" title={userLabel}>
            {event.actor.avatarUrl ? (
              <AuthenticatedAvatarImage src={event.actor.avatarUrl} alt={userLabel} />
            ) : null}
            <AvatarFallback className="rounded-full text-[9px]">
              {actorInitials(userLabel)}
            </AvatarFallback>
          </Avatar>
        ) : Icon ? (
          <Icon
            className={
              isUserFollowUp
                ? 'h-3.5 w-3.5 text-sky-500'
                : isBlockingQuestion
                  ? 'h-3.5 w-3.5 text-amber-600 dark:text-amber-400'
                  : 'h-3.5 w-3.5 text-(--color-ink-dim)'
            }
          />
        ) : (
          <div className="h-2 w-2 rounded-full bg-(--color-ink-dim)/40" />
        )}
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              isUserFollowUp
                ? 'text-xs font-medium text-sky-600 dark:text-sky-400'
                : isBlockingQuestion
                  ? 'text-xs font-medium text-amber-700 dark:text-amber-300'
                  : 'text-xs font-medium text-(--color-ink)'
            }
          >
            {isUserFollowUp && event.actor ? userLabel : label}
          </span>
          {isUserFollowUp && event.actor ? (
            <span className="text-[11px] text-(--color-ink-dim)">Follow-up</span>
          ) : null}
          {event.phase && (
            <Badge className="px-2 py-0 text-[10px] uppercase tracking-wide">{event.phase}</Badge>
          )}
          <span className="text-[11px] text-(--color-ink-dim)">
            {formatTimestamp(event.createdAt)}
          </span>
        </div>
        {event.summary ? (
          <ExpandableSummary
            text={event.summary}
            tone={isUserFollowUp ? 'text-sky-700 dark:text-sky-300' : 'text-(--color-ink-dim)'}
          />
        ) : (
          <p className="text-sm italic text-(--color-ink-dim)">No summary.</p>
        )}
        {event.externalUrl && (
          <a
            href={event.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
          >
            View details
          </a>
        )}
      </div>
    </article>
  );
}

/**
 * Collapsed execution-status section: shows the most recent launch/status event
 * as the headline. Click expands to the full chronological history for that
 * contiguous run of `status_change` + `execution_requested` events.
 */
function ExecutionStatusSection({
  events,
  missionId
}: {
  events: MissionEventDto[];
  missionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = events[0]!;
  const { icon: Icon, label: latestLabel } = eventMeta(latest.type);
  // Feed is newest-first; chronological expand list is oldest → newest.
  const chronological = [...events].reverse();
  const countLabel = `${events.length} status updates`;

  if (events.length === 1) {
    return <ActivityEntry event={latest} missionId={missionId} />;
  }

  return (
    <section className="min-w-0 rounded-md border border-(--color-ink-dim)/20 bg-(--color-ink-dim)/5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(open => !open)}
        className="flex w-full min-w-0 items-start gap-3 px-3 py-2 text-left"
      >
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
          {Icon ? (
            <Icon className="h-3.5 w-3.5 text-(--color-ink-dim)" />
          ) : (
            <div className="h-2 w-2 rounded-full bg-(--color-ink-dim)/40" />
          )}
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-(--color-ink)">Execution status</span>
            <Badge className="px-2 py-0 text-[10px] uppercase tracking-wide">{countLabel}</Badge>
            {latest.phase ? (
              <Badge className="px-2 py-0 text-[10px] uppercase tracking-wide">
                {latest.phase}
              </Badge>
            ) : null}
            <span className="text-[11px] text-(--color-ink-dim)">
              {formatTimestamp(latest.createdAt)}
            </span>
            <ChevronDown
              className={`ml-auto h-3.5 w-3.5 shrink-0 text-(--color-ink-dim) transition-transform ${
                expanded ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </div>
          <p className="line-clamp-2 text-sm text-(--color-ink-dim)">
            <span className="font-medium text-(--color-ink)/80">{latestLabel}: </span>
            {latest.summary || 'No summary.'}
          </p>
        </div>
      </button>
      {expanded ? (
        <div className="grid gap-2 border-t border-(--color-ink-dim)/15 px-3 py-2">
          {chronological.map(event => (
            <ActivityEntry key={event.id} event={event} missionId={missionId} compact />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Realtime feed of a mission's workflow history (`mission_events`) interleaved
 * with the Agent Session Module's action cards. Both queries are invalidated by
 * the global SSE change feed, so a permission raised by the agent or an update
 * written by the CLI in another process streams into the panel without a manual
 * refresh.
 *
 * The order the panel reads in is Artifacts → Deliveries → updates and
 * interactive requests → status changes. This component owns the last two: the
 * mid-feed timeline (newest-first) and the collapsed Execution status section
 * anchored beneath it. Delivery events render under Artifacts instead.
 */
export function LiveActivityFeed({ missionId }: { missionId: string }) {
  const eventsQ = useMissionEvents(missionId);
  const agentSession = useAgentSessionFeed(missionId);

  if (eventsQ.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  }

  if (eventsQ.isError) {
    return (
      <p className="text-sm text-red-400">
        Could not load activity: {(eventsQ.error as Error)?.message ?? 'unknown error'}
      </p>
    );
  }

  const events = eventsQ.data ?? [];
  const { midFeed, executionStatus } = groupMissionFeedItems(events, agentSession.items);

  if (midFeed.length === 0 && executionStatus.length === 0 && !agentSession.channel) {
    return <p className="text-sm italic text-(--color-ink-dim)">No activity yet.</p>;
  }

  return (
    <div className="grid min-w-0 gap-3">
      {/* Channel health is current state, not history, so it sits above the timeline. */}
      <SessionChannelHealthCard channel={agentSession.channel} />
      {midFeed.map(item =>
        item.kind === 'agent_session' ? (
          <AgentSessionFeedCard
            key={item.id}
            item={item.item}
            missionId={missionId}
            channel={agentSession.channel}
          />
        ) : (
          <ActivityEntry key={item.id} event={item.event} missionId={missionId} />
        )
      )}
      {executionStatus.length > 0 ? (
        <ExecutionStatusSection events={executionStatus} missionId={missionId} />
      ) : null}
    </div>
  );
}
