import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FastForward,
  FolderOpen,
  Loader2,
  Paperclip,
  RefreshCw,
  Unplug
} from 'lucide-react';
import { type MouseEvent, useId, useState } from 'react';

import type { ObjectiveDto } from '../../../shared/contract.ts';
import { getAgentIcon } from '../../lib/helpers/agent-icons.ts';
import { buildAgentResumeCommand } from '../../lib/helpers/agent-resume-command.ts';
import { useCopyToClipboard } from '../../lib/hooks/use-copy-to-clipboard.ts';
import { objectiveOriginLabel } from '../../lib/mission-origin.ts';
import type { ObjectiveEvidence } from '../../lib/objective-evidence.ts';
import { missionDraftResourceBadgeKey, projectResourceLabel } from '../../lib/project-resources.ts';
import {
  useAgentCatalog,
  useObjectiveAttachments,
  useProject,
  useProjectResources,
  useUpdateObjective
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
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
 * only horizontal inset.
 */
export function ObjectiveCollapsibleItem({
  objective,
  index,
  evidence,
  loading,
  open,
  onToggle
}: {
  objective: ObjectiveDto;
  index: number;
  evidence: ObjectiveEvidence;
  loading: ObjectiveEvidenceLoading;
  open: boolean;
  /** `additive` is true for shift-click, which opens alongside other rows instead of replacing them. */
  onToggle: (options: { additive: boolean }) => void;
}) {
  const update = useUpdateObjective();
  const { copied, copy } = useCopyToClipboard();
  const [forceDisconnectOpen, setForceDisconnectOpen] = useState(false);
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

  const forceDisconnect = async () => {
    await update.mutateAsync({ id: objective.id, body: { state: 'draft' } });
    setForceDisconnectOpen(false);
  };

  const toggle = (event: MouseEvent) => onToggle({ additive: event.shiftKey });

  return (
    <Collapsible open={open}>
      <div className="relative overflow-hidden">
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
            'relative flex cursor-pointer flex-col gap-0.5 py-2 pl-5 pr-4 transition-colors',
            !inFlight && 'hover:bg-muted/40'
          )}
          onClick={event => {
            if (!event.currentTarget.contains(event.target as Node)) return;
            toggle(event);
          }}
        >
          {inFlight ? (
            <div className="pointer-events-none absolute inset-0 animate-[shimmer_3s_linear_infinite] bg-size-[200%_100%] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent" />
          ) : null}
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
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
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
          {resourceLabel || objective.autoAdvance ? (
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
              {resourceLabel && objective.autoAdvance ? (
                <span aria-hidden="true" className="text-muted-foreground/60">
                  ·
                </span>
              ) : null}
              {objective.autoAdvance ? (
                <span className="inline-flex shrink-0 items-center gap-1">
                  <FastForward className="h-3 w-3" />
                  <span>Auto-advance</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <CollapsibleContent id={panelId} className="pb-3 pl-5 pr-4 pt-1">
          <ObjectiveEvidenceSections
            objective={objective}
            evidence={evidence}
            attachments={attachments}
            mode={inFlight ? 'active' : 'complete'}
            loading={loading}
          />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
