import { ChevronDown, GitBranch, History } from 'lucide-react';
import { useState } from 'react';

import type {
  DeliveryDto,
  ObjectiveAttachmentDto,
  ObjectiveDto
} from '../../../shared/contract.ts';
import {
  groupEvidenceByRun,
  NO_EVIDENCE_TRUNCATION,
  type ObjectiveEvidence,
  type ObjectiveEvidenceTruncation,
  type ObjectiveRun,
  objectiveRunLabel
} from '../../lib/objective-evidence.ts';
import { cn } from '../../lib/utils.ts';
import { AgentSessionActivity } from '../agent-session/AgentSessionActivity.tsx';
import { MissionDeliveryCard } from '../DeliverySummaryCard.tsx';
import { InlineEditField } from '../InlineEditField.tsx';
import { ObjectiveTerminalSessions } from '../ObjectiveTerminalSessions.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx';

import { ObjectiveAttachmentList } from './ObjectiveAttachments.tsx';
import {
  ObjectiveEvidenceEmpty,
  ObjectiveEvidenceRule,
  ObjectiveEvidenceTruncationNotice
} from './ObjectiveEvidenceRule.tsx';
import { ObjectiveFileChanges } from './ObjectiveFileChanges.tsx';

/**
 * Which arrangement of the evidence stack to draw (coo:879 §4.2 / §4.3 / §4.5):
 *
 * - `complete` — instruction → deliveries → files changed during this
 *   objective → terminal session (only when one exists) → earlier runs →
 *   attachments.
 * - `active` — instruction → agent activity → prior deliveries (only on a
 *   pending-delivery re-attach) → files changed (live) → terminal session
 *   (only when one exists) → earlier runs → attachments.
 * - `history` — the reverted draft's previous runs, then the objective's
 *   cumulative file list, with no instruction (the draft's editable field
 *   already shows it) and no attachments (the draft's own footer lists them).
 *
 * The file list is cumulative per objective, so it appears once and never
 * inside a run; runs split only deliveries and terminal sessions.
 *
 * In `complete` and `active`, the instruction is the first thing under the
 * row's trigger, drawn flat with no rule or disclosure of its own (coo:1041).
 */
export type ObjectiveEvidenceMode = 'complete' | 'active' | 'history';

export type ObjectiveEvidenceLoading = {
  deliveries: boolean;
};

function deliveryLabel(index: number, total: number): string {
  // A run can deliver more than once (a follow-up re-attach after delivery).
  // `deliveries` is newest first, so the oldest delivery in the run is 1.
  return total > 1 ? `Delivery ${total - index} of ${total}` : 'Delivery';
}

function TruncationNotice({ notice }: { notice: string | null }) {
  if (!notice) return null;
  return <ObjectiveEvidenceTruncationNotice>{notice}</ObjectiveEvidenceTruncationNotice>;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * One run's deliveries, newest first. The latest is the open card; any others
 * from the same run are collapsed cards below it.
 */
function RunDeliveries({
  deliveries,
  expandLatest
}: {
  deliveries: readonly DeliveryDto[];
  expandLatest: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      {deliveries.map((delivery, index) => (
        <MissionDeliveryCard
          key={delivery.id}
          delivery={delivery}
          objectiveTitle={deliveryLabel(index, deliveries.length)}
          defaultExpanded={expandLatest && index === 0}
        />
      ))}
    </div>
  );
}

function ObjectiveInstruction({ objective }: { objective: ObjectiveDto }) {
  return (
    <div className="min-w-0">
      {objective.branch ? (
        <p className="mb-2 flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground/80">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="truncate">{objective.branch}</span>
        </p>
      ) : null}
      {objective.externalSessionId ? (
        <p className="mb-2 truncate font-mono text-[11px] text-muted-foreground/80">
          Agent session: {objective.externalSessionId}
        </p>
      ) : null}
      <div className="min-w-0 text-sm leading-relaxed text-muted-foreground">
        {/*
          `wrap-anywhere` (not just `break-words`): instruction text routinely
          carries an unbroken token with no break opportunity at all — a long
          absolute path, a URL, a base64 blob — and without it that single word
          sets the row's min-content width and pushes the panel past the
          viewport edge.
        */}
        <InlineEditField
          multiline
          disabled
          value={objective.instructionText}
          className="block whitespace-pre-wrap wrap-anywhere"
          ariaLabel="Objective instruction"
          onSave={() => undefined}
        />
      </div>
    </div>
  );
}

function LiveTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-500/15 px-1 py-px font-mono text-[9px] tracking-normal text-emerald-700 dark:text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      live
    </span>
  );
}

/** The per-run evidence bodies, so every arrangement draws them the same way. */
function buildRunSections({
  run,
  loading,
  expandLatestDelivery
}: {
  run: ObjectiveRun;
  loading: ObjectiveEvidenceLoading;
  expandLatestDelivery: boolean;
}) {
  const deliveries = loading.deliveries ? (
    <ObjectiveEvidenceEmpty>Loading deliveries…</ObjectiveEvidenceEmpty>
  ) : run.deliveries.length === 0 ? (
    <ObjectiveEvidenceEmpty>No delivery recorded</ObjectiveEvidenceEmpty>
  ) : (
    <RunDeliveries deliveries={run.deliveries} expandLatest={expandLatestDelivery} />
  );

  // A run without a (visible) terminal session draws nothing for it — no rule, no empty state.
  const terminalSessions = (
    <ObjectiveTerminalSessions
      sessions={run.terminalSessions}
      heading={<ObjectiveEvidenceRule label="Terminal session" />}
    />
  );

  return {
    deliveries,
    terminalSessions,
    deliveryCount: loading.deliveries ? undefined : run.deliveries.length
  };
}

/** Deliveries → terminal session (if any) for one run, as a flat stack. */
function RunStack({
  run,
  loading,
  expandLatestDelivery,
  truncation
}: {
  run: ObjectiveRun;
  loading: ObjectiveEvidenceLoading;
  expandLatestDelivery: boolean;
  truncation: ObjectiveEvidenceTruncation;
}) {
  const sections = buildRunSections({ run, loading, expandLatestDelivery });
  return (
    <div className="grid min-w-0 gap-2">
      <ObjectiveEvidenceRule label="Deliveries" count={sections.deliveryCount} />
      {sections.deliveries}
      <TruncationNotice notice={truncation.deliveries} />
      {sections.terminalSessions}
    </div>
  );
}

/**
 * A compact, collapsed row for a run that is not the objective's latest —
 * secondary information, so the one place nesting is allowed inside the
 * evidence stack. Opens to the same flat run stack the latest run uses.
 */
function EarlierRunRow({
  run,
  loading,
  truncation,
  defaultOpen = false
}: {
  run: ObjectiveRun;
  loading: ObjectiveEvidenceLoading;
  truncation: ObjectiveEvidenceTruncation;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const summary = [
    run.deliveries.length > 0 ? countLabel(run.deliveries.length, 'delivery', 'deliveries') : null,
    run.terminalSessions.length > 0
      ? countLabel(run.terminalSessions.length, 'session', 'sessions')
      : null
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border border-border/50 bg-muted/20">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground outline-none hover:bg-muted/40">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="font-medium text-foreground/80">
            {objectiveRunLabel(run) ?? 'Earlier run'}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/80">
            {summary}
          </span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <RunStack
            run={run}
            loading={loading}
            expandLatestDelivery={false}
            truncation={truncation}
          />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/** The collapsed rows for every run before the latest, under one rule. */
function EarlierRuns({
  runs,
  loading,
  truncation
}: {
  runs: readonly ObjectiveRun[];
  loading: ObjectiveEvidenceLoading;
  truncation: ObjectiveEvidenceTruncation;
}) {
  if (runs.length === 0) return null;
  return (
    <>
      <ObjectiveEvidenceRule label="Earlier runs" count={runs.length} />
      <div className="grid min-w-0 gap-1.5">
        {runs.map(run => (
          <EarlierRunRow key={run.number} run={run} loading={loading} truncation={truncation} />
        ))}
      </div>
    </>
  );
}

/**
 * The flat, full-width stack of everything one objective produced, rendered
 * inside its accordion (coo:879 §4.2). The instruction leads, flat and
 * unlabeled, directly under the row's trigger (coo:1041); the sections after
 * it are separated by thin labeled rules. The files-changed rule is also a
 * disclosure trigger that starts closed (chevron left of the label), because
 * its body is unbounded; deliveries and the terminal session stay flat and
 * always visible, and the terminal session is omitted entirely when the run
 * has none. Beyond those, only secondary rows (earlier runs, capture details)
 * fold. Empty states are one-line muted italics so "nothing captured" and
 * "tracking unavailable" read distinctly from "still loading".
 *
 * Every stack container is `min-w-0` and the row's panel forces
 * `overflow-wrap: anywhere`, so a single unbroken token in an instruction, a
 * delivery summary, or a path can never set the min-content width and drag the
 * mission panel past the viewport edge.
 *
 * Evidence is split into runs by `objective.reopenedAt` (contract v133), with
 * delivery-order inference as the fallback for objectives that predate the
 * column; see `groupEvidenceByRun`. The latest run is the flat stack; earlier
 * runs are collapsed "Run 1 of 2" rows. The file list spans every run.
 */
export function ObjectiveEvidenceSections({
  objective,
  evidence,
  attachments = [],
  mode,
  loading,
  truncation = NO_EVIDENCE_TRUNCATION
}: {
  objective: ObjectiveDto;
  evidence: ObjectiveEvidence;
  attachments?: readonly ObjectiveAttachmentDto[];
  mode: ObjectiveEvidenceMode;
  loading: ObjectiveEvidenceLoading;
  truncation?: ObjectiveEvidenceTruncation;
}) {
  // A reverted draft's latest run has not happened yet, so it is not kept as
  // an empty bucket; a completed or executing objective always has one.
  const runs = groupEvidenceByRun(evidence, objective, { keepEmptyLatest: mode !== 'history' });

  if (mode === 'history') {
    return (
      <div className="grid min-w-0 gap-2">
        {runs.length === 1 ? (
          <RunStack run={runs[0]!} loading={loading} expandLatestDelivery truncation={truncation} />
        ) : runs.length > 1 ? (
          // Several previous runs: every one is a row, the most recent open.
          <div className="grid min-w-0 gap-1.5">
            {runs.map((run, index) => (
              <EarlierRunRow
                key={run.number}
                run={run}
                loading={loading}
                truncation={truncation}
                defaultOpen={index === 0}
              />
            ))}
          </div>
        ) : null}
        <ObjectiveFileChanges objective={objective} />
      </div>
    );
  }

  const [latest, ...earlier] = runs as [ObjectiveRun, ...ObjectiveRun[]];
  const sections = buildRunSections({
    run: latest,
    loading,
    expandLatestDelivery: mode !== 'active'
  });

  if (mode === 'active') {
    return (
      <div className="grid min-w-0 gap-2">
        <ObjectiveInstruction objective={objective} />
        <AgentSessionActivity missionId={objective.missionId} objectiveId={objective.id} />
        {latest.deliveries.length > 0 ? (
          <>
            <ObjectiveEvidenceRule label="Deliveries" count={sections.deliveryCount} />
            {sections.deliveries}
            <TruncationNotice notice={truncation.deliveries} />
          </>
        ) : null}
        <ObjectiveFileChanges objective={objective} trailing={<LiveTag />} />
        {sections.terminalSessions}
        <EarlierRuns runs={earlier} loading={loading} truncation={truncation} />
        {attachments.length > 0 ? (
          <>
            <ObjectiveEvidenceRule label="Attachments" count={attachments.length} />
            <ObjectiveAttachmentList attachments={[...attachments]} readOnly className="-ml-2" />
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      <ObjectiveInstruction objective={objective} />
      <ObjectiveEvidenceRule label="Deliveries" count={sections.deliveryCount} />
      {sections.deliveries}
      <TruncationNotice notice={truncation.deliveries} />
      <ObjectiveFileChanges objective={objective} />
      {sections.terminalSessions}
      <EarlierRuns runs={earlier} loading={loading} truncation={truncation} />
      {attachments.length > 0 ? (
        <>
          <ObjectiveEvidenceRule label="Attachments" count={attachments.length} />
          <ObjectiveAttachmentList attachments={[...attachments]} readOnly className="-ml-2" />
        </>
      ) : null}
    </div>
  );
}
