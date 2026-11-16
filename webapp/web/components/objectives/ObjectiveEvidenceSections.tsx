import type { DeliveryDto, ObjectiveDto } from '@overlord/contract';
import { ChevronDown, History } from 'lucide-react';
import { useState } from 'react';

import {
  groupEvidenceByRun,
  NO_EVIDENCE_TRUNCATION,
  type ObjectiveEvidence,
  type ObjectiveEvidenceTruncation,
  type ObjectiveRun,
  objectiveRunLabel
} from '../../lib/objective-evidence.ts';
import { cn } from '../../lib/utils.ts';
import { MissionDeliveryCard, useMissionDeliveryVariant } from '../DeliverySummaryCard.tsx';
import { ObjectiveTerminalSessions } from '../ObjectiveTerminalSessions.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx';

import {
  ObjectiveEvidenceEmpty,
  ObjectiveEvidenceRule,
  ObjectiveEvidenceTruncationNotice
} from './ObjectiveEvidenceRule.tsx';
import { ObjectiveFileChanges } from './ObjectiveFileChanges.tsx';

/**
 * Which arrangement of an objective's evidence the objective detail draws
 * (mission-panel-redesign plan §9.4). The detail renders the instruction,
 * blocking requests, the current terminal session and attachments elsewhere, so
 * every mode draws only deliveries, file changes and earlier runs:
 *
 * - `complete` — deliveries (each latest-run delivery open, so its summary and
 *   assumptions show) → files changed during this objective → earlier runs.
 * - `active` — prior deliveries (only when the run already delivered, e.g. a
 *   pending-delivery re-attach) → files changed (live) → earlier runs.
 * - `history` — a reverted draft's previous runs, then the objective's
 *   cumulative file list.
 *
 * The file list is cumulative per objective, so it appears once and never
 * inside a run; runs split only deliveries and terminal sessions.
 */
export type ObjectiveEvidenceMode = 'complete' | 'active' | 'history';

export type ObjectiveEvidenceLoading = {
  deliveries: boolean;
  /** A failed/missing response cannot authorize deleting an apparently empty draft. */
  deliveriesUnavailable?: boolean;
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
  expandLatest,
  expandAll = false
}: {
  deliveries: readonly DeliveryDto[];
  expandLatest: boolean;
  /** Open every delivery card, so each one's summary and assumptions are on screen. */
  expandAll?: boolean;
}) {
  // `objective` only on summary-eligible missions; the mission summary carries
  // their actions and deferred work instead (plan §3.1).
  const variant = useMissionDeliveryVariant();
  return (
    <div className="grid min-w-0 gap-2">
      {deliveries.map((delivery, index) => (
        <MissionDeliveryCard
          key={delivery.id}
          delivery={delivery}
          objectiveTitle={deliveryLabel(index, deliveries.length)}
          defaultExpanded={expandAll || (expandLatest && index === 0)}
          variant={variant}
        />
      ))}
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
  expandLatestDelivery,
  expandAllDeliveries = false
}: {
  run: ObjectiveRun;
  loading: ObjectiveEvidenceLoading;
  expandLatestDelivery: boolean;
  expandAllDeliveries?: boolean;
}) {
  const deliveries = loading.deliveries ? (
    <ObjectiveEvidenceEmpty>Loading deliveries…</ObjectiveEvidenceEmpty>
  ) : run.deliveries.length === 0 ? (
    <ObjectiveEvidenceEmpty>No delivery recorded</ObjectiveEvidenceEmpty>
  ) : (
    <RunDeliveries
      deliveries={run.deliveries}
      expandLatest={expandLatestDelivery}
      expandAll={expandAllDeliveries}
    />
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
 * Everything one objective produced, for the objective detail (plan §9.4).
 * Sections are separated by thin labeled rules; the files-changed rule is also a
 * disclosure that starts closed, because its body is unbounded. Earlier runs
 * fold into compact rows. Empty states are one-line muted italics so "nothing
 * captured" and "tracking unavailable" read distinctly from "still loading".
 *
 * Every container is `min-w-0`, so a single unbroken token in a delivery
 * summary or a path can never set the min-content width and drag the dialog
 * past the viewport edge.
 *
 * Evidence is split into runs by `objective.reopenedAt` (contract v133), with
 * delivery-order inference as the fallback for objectives that predate the
 * column; see `groupEvidenceByRun`.
 */
export function ObjectiveEvidenceSections({
  objective,
  evidence,
  mode,
  loading,
  truncation = NO_EVIDENCE_TRUNCATION
}: {
  objective: ObjectiveDto;
  evidence: ObjectiveEvidence;
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
    expandLatestDelivery: mode !== 'active',
    expandAllDeliveries: true
  });
  // While in flight, a run with no delivery yet draws no empty Deliveries rule.
  const showDeliveries = mode !== 'active' || latest.deliveries.length > 0 || loading.deliveries;

  return (
    <div className="grid min-w-0 gap-2">
      {showDeliveries ? (
        <>
          <ObjectiveEvidenceRule label="Deliveries" count={sections.deliveryCount} />
          {sections.deliveries}
          <TruncationNotice notice={truncation.deliveries} />
        </>
      ) : null}
      <ObjectiveFileChanges
        objective={objective}
        trailing={mode === 'active' ? <LiveTag /> : undefined}
      />
      <EarlierRuns runs={earlier} loading={loading} truncation={truncation} />
    </div>
  );
}
