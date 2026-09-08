import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FolderOpen,
  HelpCircle,
  ListOrdered,
  Loader2,
  Paperclip,
  RefreshCw,
  Unplug,
  X
} from 'lucide-react';
import { type MouseEvent, useEffect, useId, useRef, useState } from 'react';

import type { ObjectiveDto } from '../../../shared/contract.ts';
import { getAgentIcon } from '../../lib/helpers/agent-icons.ts';
import { buildAgentResumeCommand } from '../../lib/helpers/agent-resume-command.ts';
import { useCopyToClipboard } from '../../lib/hooks/use-copy-to-clipboard.ts';
import { objectiveOriginLabel } from '../../lib/mission-origin.ts';
import { selectObjectiveBlockingRequests } from '../../lib/objective-blocking-requests.ts';
import type {
  ObjectiveEvidence,
  ObjectiveEvidenceTruncation
} from '../../lib/objective-evidence.ts';
import { missionDraftResourceBadgeKey, projectResourceLabel } from '../../lib/project-resources.ts';
import {
  useAgentCatalog,
  useObjectiveAttachments,
  useProject,
  useProjectResources,
  useUpdateObjective
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { useAgentSessionFeed } from '../agent-session/AgentSessionActivity.tsx';
import { OriginSparklesIcon } from '../OriginSparklesIcon.tsx';
import { Button } from '../ui/button.tsx';
import { Collapsible, CollapsibleContent } from '../ui/collapsible.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../ui/dialog.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

import { AgentIcon } from './AgentIcon.tsx';
import { ObjectiveEvidenceBadges } from './ObjectiveEvidenceBadges.tsx';
import {
  type ObjectiveEvidenceLoading,
  ObjectiveEvidenceSections
} from './ObjectiveEvidenceSections.tsx';
import { ObjectiveMenuButton } from './ObjectiveMenuButton.tsx';

/** Stops a header-action click from also toggling the row it sits in. */
function stopRowToggle(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * A read-first row for an objective that has left the editable stages
 * (executing, pending delivery, or complete), redesigned around the objective
 * as the container for its own evidence (coo:879).
 *
 * The header is three lines: the title and chevron; then the informational
 * icons (state, agent, display id, provenance, attachments) with the evidence
 * badges and header actions right-aligned; then the resource folder and queue
 * status. Expanding the row reveals the flat evidence stack
 * ({@link ObjectiveEvidenceSections}) — deliveries, terminal session, file
 * changes — rather than only the instruction text.
 *
 * Rows run edge to edge across the mission panel (§4.1.1): no side borders and
 * no radius, so the hover wash and the in-flight shimmer sweep the full width,
 * and the list's dividers do the separating. The row's own padding is the
 * only horizontal inset. An open row also carries a slightly darker wash over
 * its full height so it reads as one block against the collapsed rows around
 * it, and the in-flight shimmer covers header and open body alike.
 *
 * While the row is in flight it also watches its own agent-session feed: a
 * blocking question or structured choice renders inside this row's body, so a
 * collapsed row would otherwise hide a request the agent is stopped on. An
 * unanswered request tints the whole row with the blocking-question amber,
 * puts a counted badge on line two, and opens the row once — and the user can
 * dismiss that status without answering (coo:879).
 */
export function ObjectiveCollapsibleItem({
  objective,
  index,
  evidence,
  loading,
  truncation,
  open,
  onToggle,
  onOpenForRequest
}: {
  objective: ObjectiveDto;
  index: number;
  evidence: ObjectiveEvidence;
  loading: ObjectiveEvidenceLoading;
  truncation?: ObjectiveEvidenceTruncation;
  open: boolean;
  /** `additive` is true for shift-click, which opens alongside other rows instead of replacing them. */
  onToggle: (options: { additive: boolean }) => void;
  /** Opens this row without closing any other — used when the agent raises a new request. */
  onOpenForRequest?: () => void;
}) {
  const update = useUpdateObjective();
  const { copied, copy } = useCopyToClipboard();
  const [forceDisconnectOpen, setForceDisconnectOpen] = useState(false);
  /** Request ids the user waved away; a new id is never in here, so it re-arms the badge. */
  const [dismissedRequestIds, setDismissedRequestIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const panelId = useId();
  // Display labels come from the objective's own workspace's catalog (coo:324).
  const projectQuery = useProject(objective.projectId);
  const catalogQuery = useAgentCatalog(projectQuery.data?.workspaceId);
  const resourcesQuery = useProjectResources(objective.projectId);
  const { data: attachments = [] } = useObjectiveAttachments(objective.id);
  const hasAttachments = attachments.length > 0;
  const resources = resourcesQuery.data ?? [];
  const resourceKey = missionDraftResourceBadgeKey({
    resources,
    draftObjectiveResourceKey: objective.resourceKey
  });
  const resourceLabel = resourceKey ? projectResourceLabel({ resources, resourceKey }) : null;

  const isExecuting = objective.state === 'executing';
  const isPendingDelivery = objective.state === 'pending_delivery';
  const inFlight = isExecuting || isPendingDelivery;
  const timestampLabel = isExecuting
    ? 'Executing since'
    : isPendingDelivery
      ? 'Pending delivery since'
      : 'Completed';
  const objectiveTimestamp = new Date(
    (objective.state === 'complete' ? objective.completedAt : objective.startedAt) ??
      objective.updatedAt
  ).toLocaleString();

  const catalogAgent = catalogQuery.data?.agents.find(a => a.key === objective.assignedAgent);
  const catalogModel = catalogAgent?.models.find(m => m.id === objective.model);
  const agentLabel = catalogAgent?.label ?? objective.assignedAgent;
  const modelLabel = catalogModel?.displayName ?? objective.model;
  const agentTooltip = modelLabel ? `${agentLabel} · ${modelLabel}` : agentLabel;
  const hasAgentIcon = objective.assignedAgent
    ? getAgentIcon(objective.assignedAgent) !== null
    : false;
  // Provenance sits *after* the identity icons, never in the leading state
  // slot: that slot already means "this agent ran this objective", and one row
  // cannot carry two different agent claims in the same position.
  const originLabel = objectiveOriginLabel(objective);
  // Lets the user reopen the agent's own conversation thread in a terminal to
  // discuss what happened in this objective — outside Overlord entirely (no
  // execution request or session). Only available once the objective recorded a
  // native session id and its agent has a known resume command.
  const resumeCommand = buildAgentResumeCommand({
    agent: objective.assignedAgent,
    sessionId: objective.externalSessionId
  });

  // Only an in-flight objective can be blocked on a human, and passing `null`
  // leaves the underlying polled query disabled for every completed row.
  const agentRequests = useAgentSessionFeed(objective.missionId, inFlight ? objective.id : null);
  const blocking = selectObjectiveBlockingRequests({
    requests: agentRequests.items.map(item => item.request),
    dismissedIds: dismissedRequestIds
  });
  // Open the row once per request id — mirroring the start-of-execution auto-open
  // in MissionObjectivesSection — so the agent's question is visible when it
  // arrives, without fighting a user who collapses the row on every 5s refetch.
  const pendingRequestKey = blocking.pendingIds.join(',');
  const openedForRequestRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = pendingRequestKey
      .split(',')
      .filter(id => id.length > 0 && !openedForRequestRef.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) openedForRequestRef.current.add(id);
    onOpenForRequest?.();
  }, [onOpenForRequest, pendingRequestKey]);

  const forceDisconnect = async () => {
    await update.mutateAsync({ id: objective.id, body: { state: 'draft' } });
    setForceDisconnectOpen(false);
  };

  const toggle = (event: MouseEvent) => onToggle({ additive: event.shiftKey });

  return (
    <Collapsible className="min-w-0" open={open}>
      {/*
        An open row carries a slightly darker wash across its whole height —
        header and evidence body — so it reads as one block distinct from the
        collapsed rows above and below it. A row waiting on an unanswered agent
        request wears the blocking-question amber instead, which outranks the
        open wash: "this needs you" is the more urgent thing to say.
      */}
      <div
        className={cn(
          'relative min-w-0 overflow-hidden transition-colors',
          open && !blocking.isBlocking && 'bg-muted/30',
          blocking.isBlocking && 'bg-amber-50/70 dark:bg-amber-500/10'
        )}
      >
        {/*
          The executing shimmer sweeps the whole row — header and open body
          alike — but not while the row is blocked: an agent stopped on a
          question is not making progress, and the amber tint says so.
        */}
        {inFlight && !blocking.isBlocking ? (
          <div className="pointer-events-none absolute inset-0 z-0 animate-[shimmer_3s_linear_infinite] bg-size-[200%_100%] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent" />
        ) : null}
        {/*
          The whole header toggles the row, but header actions live on line two
          alongside the badges, and a button cannot nest inside a button. So the
          accessible trigger is the line-one button and the surrounding header
          div forwards clicks on lines two and three; actions stop propagation.
          The kebab menu and the force-disconnect dialog render through portals,
          and React bubbles their clicks up this tree even though they are not
          inside the header in the DOM — hence the containment check.
        */}
        <div
          className={cn(
            'relative z-10 flex cursor-pointer flex-col gap-0.5 py-2 pl-5 pr-4 transition-colors',
            !inFlight && (open ? 'hover:bg-muted/25' : 'hover:bg-muted/40')
          )}
          onClick={event => {
            if (!event.currentTarget.contains(event.target as Node)) return;
            toggle(event);
          }}
        >
          {/* Line 1 — title and chevron. */}
          <button
            type="button"
            className="relative flex w-full min-w-0 items-center justify-between gap-2 text-left outline-none"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={event => {
              event.stopPropagation();
              toggle(event);
            }}
          >
            <p
              className="min-w-0 flex-1 truncate text-sm font-medium"
              title={`${timestampLabel} ${objectiveTimestamp}`}
            >
              {objective.title ?? `Objective ${index + 1}`}
            </p>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </button>

          {/* Line 2 — informational icons left, evidence badges and actions right. */}
          <div className="relative flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {isExecuting ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : isPendingDelivery ? (
                // A refresh mark, not a warning: the agent re-attached to the
                // objective and is working again — nothing has gone wrong.
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground [animation-duration:2.5s]" />
              ) : objective.state === 'complete' ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              ) : null}
              {hasAgentIcon ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="inline-flex shrink-0">
                        <AgentIcon
                          agentKey={objective.assignedAgent ?? ''}
                          size={14}
                          alt={agentLabel ?? ''}
                          className="h-3.5 w-3.5"
                        />
                      </span>
                    }
                  />
                  <TooltipContent side="top">{agentTooltip}</TooltipContent>
                </Tooltip>
              ) : null}
              {objective.displayId ? (
                // The one shrinkable thing on line two: when the blocking badge
                // joins the right-hand group in a narrow panel, the display id
                // gives up width before an action button gets clipped.
                <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                  {objective.displayId}
                </span>
              ) : null}
              {originLabel ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="inline-flex shrink-0" aria-label={originLabel}>
                        <OriginSparklesIcon />
                      </span>
                    }
                  />
                  <TooltipContent side="top">{originLabel}</TooltipContent>
                </Tooltip>
              ) : null}
              {hasAttachments ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="inline-flex shrink-0">
                        <Paperclip
                          className="h-3 w-3 text-muted-foreground"
                          aria-label={`${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`}
                        />
                      </span>
                    }
                  />
                  <TooltipContent side="top">
                    {attachments.length === 1
                      ? '1 attachment'
                      : `${attachments.length} attachments`}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {blocking.isBlocking ? (
                <span className="inline-flex shrink-0 items-center rounded-sm border border-amber-400/50 bg-amber-100/70 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-300">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={blocking.label ?? 'Agent request waiting'}
                          className="inline-flex items-center gap-0.5 rounded-sm py-px pl-1 pr-0.5 font-mono text-[11px] tabular-nums hover:bg-amber-500/20"
                          onClick={event => {
                            stopRowToggle(event);
                            if (!open) onToggle({ additive: true });
                          }}
                        />
                      }
                    >
                      <HelpCircle className="h-3 w-3" aria-hidden="true" />
                      <span>{blocking.count}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top">{blocking.label}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label="Dismiss blocking status"
                          className="inline-flex h-4 w-4 items-center justify-center rounded-sm hover:bg-amber-500/30"
                          onClick={event => {
                            stopRowToggle(event);
                            setDismissedRequestIds(
                              current => new Set([...current, ...blocking.activeIds])
                            );
                          }}
                        />
                      }
                    >
                      <X className="h-2.5 w-2.5" aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Dismiss until the agent asks again — the request stays answerable inside this
                      objective
                    </TooltipContent>
                  </Tooltip>
                </span>
              ) : null}
              <ObjectiveEvidenceBadges
                evidence={evidence}
                startedAt={objective.startedAt}
                completedAt={objective.completedAt}
              />
              {objective.externalSessionId ? (
                <button
                  type="button"
                  aria-label="Copy agent session"
                  title="Copy agent session ID"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  onClick={async event => {
                    stopRowToggle(event);
                    await copy(objective.externalSessionId ?? '');
                  }}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : null}
              {isExecuting ? (
                <Dialog open={forceDisconnectOpen} onOpenChange={setForceDisconnectOpen}>
                  <DialogTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Force disconnect objective"
                        title="Force disconnect"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={stopRowToggle}
                      />
                    }
                  >
                    <Unplug className="h-3.5 w-3.5" />
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Force disconnect this objective?</DialogTitle>
                      <DialogDescription>
                        This ends Overlord&apos;s active session and clears its pending launch. The
                        objective returns to Draft, and any existing draft becomes the first future
                        objective. Its deliveries, file changes, and terminal session are kept as
                        previous runs.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="secondary" onClick={() => setForceDisconnectOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={update.isPending}
                        onClick={() => void forceDisconnect()}
                      >
                        {update.isPending ? 'Disconnecting…' : 'Force disconnect'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : null}
              <ObjectiveMenuButton
                objectiveId={objective.id}
                displayId={objective.displayId}
                state={objective.state}
                resumeCommand={resumeCommand}
              />
            </div>
          </div>

          {/* Line 3 — resource folder and queue status. */}
          {resourceLabel || objective.queueEntry ? (
            <div className="relative flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {resourceLabel ? (
                <span
                  className="inline-flex min-w-0 items-center gap-1"
                  title={`Resource: ${resourceLabel}`}
                >
                  <FolderOpen className="h-3 w-3 shrink-0" />
                  <span className="truncate">{resourceLabel}</span>
                </span>
              ) : null}
              {resourceLabel && objective.queueEntry ? (
                <span aria-hidden="true" className="text-muted-foreground/60">
                  ·
                </span>
              ) : null}
              {objective.queueEntry ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1"
                  title={`Queued in ${objective.queueEntry.queueName}`}
                >
                  <ListOrdered className="h-3 w-3" />
                  <span>Queued</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {/*
          `min-w-0` + `wrap-anywhere` are the row's wrapping floor. Both are
          load-bearing and neither substitutes for the other: `min-w-0` stops
          the panel from being widened to its content's min-content width (a
          flex/grid item defaults to `min-width: auto`, which the row's
          `overflow-hidden` does *not* reset), and `overflow-wrap: anywhere` —
          inherited by every descendant that does not `truncate` — gives an
          unbroken token somewhere to break. Without them a single long path or
          URL in an instruction, delivery summary, or agent message pushes the
          whole mission panel past the right edge of the window.
        */}
        <CollapsibleContent
          id={panelId}
          className="relative z-10 min-w-0 pb-3 pl-5 pr-4 pt-1 wrap-anywhere"
        >
          <ObjectiveEvidenceSections
            objective={objective}
            evidence={evidence}
            attachments={attachments}
            mode={inFlight ? 'active' : 'complete'}
            loading={loading}
            truncation={truncation}
          />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
