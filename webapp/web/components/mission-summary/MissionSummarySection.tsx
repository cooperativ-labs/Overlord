import { ChevronRight, Loader2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import type {
  DeliveryDto,
  MissionDetailDto,
  MissionSummaryEvidenceDto
} from '../../../shared/contract.ts';
import {
  useAcknowledgeMissionSummary,
  useMissionSummaryVisitBaseline
} from '../../lib/hooks/use-mission-summary-seen.ts';
import {
  missionSummaryActions,
  missionSummaryFiles,
  missionSummaryRisks,
  missionSummaryRunningSentences,
  missionSummarySectionState,
  missionSummarySources,
  missionSummaryStatusChip,
  missionSummarySuggestions,
  openSummaryQuestions,
  type SummaryObjective,
  summaryWatermarkIsDisplayed,
  updatingSourceObjective
} from '../../lib/mission-summary-derive.ts';
import {
  useMissionAgentRequests,
  useMissionDeliveries,
  useMissionFileChanges,
  useMissionSummary
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

import { MissionSummaryActions } from './MissionSummaryActions.tsx';
import { MissionSummaryFiles } from './MissionSummaryFiles.tsx';
import { MissionSummaryHeader } from './MissionSummaryHeader.tsx';
import { summaryFocusRing } from './MissionSummaryParts.tsx';
import { MissionSummaryPost } from './MissionSummaryPost.tsx';
import { MissionSummaryRisks } from './MissionSummaryRisks.tsx';
import { MissionSummarySuggestions } from './MissionSummarySuggestions.tsx';

/** A clock for relative labels, ticking once a minute. */
function useMinuteClock(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const NO_DELIVERIES: DeliveryDto[] = [];

const EMPTY_EVIDENCE: MissionSummaryEvidenceDto = {
  actions: [],
  sources: [],
  totals: { actions: 0, sources: 0, currentRunDeliveries: 0 },
  truncated: { actions: false, sources: false }
};

function UpdatingStrip({ label }: { label: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-sky-200 bg-sky-50 px-5 py-2.5 text-sm text-sky-950 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100">
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <span className="min-w-0 wrap-anywhere">{label}</span>
    </div>
  );
}

function SummaryFooter() {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-(--color-border) px-5 py-2 text-xs text-(--color-ink-dim)">
      <span>Rewritten after each delivery, answer and decision</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-disabled="true"
              onClick={event => event.preventDefault()}
              className={cn(
                'inline-flex cursor-not-allowed items-center gap-1 px-2 py-0.5 text-xs font-medium text-(--color-ink-dim) opacity-70',
                summaryFocusRing
              )}
            />
          }
        >
          Previous summaries
          <ChevronRight className="size-3" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>Summary history is not stored yet.</TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * The Mission summary section (plan §5): what happened, what the operator
 * still has to do, what should happen next, significant risks, and the files
 * changed across the mission. Hidden on ineligible missions, which keep the
 * full delivery presentation in the objective rows.
 *
 * Mount with `key={mission.id}`: the new-item dot baseline is frozen per visit.
 */
export function MissionSummarySection({ mission }: { mission: MissionDetailDto }) {
  const summaryQ = useMissionSummary(mission.id);
  const response = summaryQ.data;
  const eligible = response?.eligible === true;
  const requestsQ = useMissionAgentRequests(mission.id, undefined, eligible);
  const deliveriesQ = useMissionDeliveries(mission.id, eligible);
  const fileChangesQ = useMissionFileChanges(mission.id);
  const baseline = useMissionSummaryVisitBaseline(response) ?? null;
  const now = useMinuteClock();
  const sectionRef = useRef<HTMLDivElement>(null);

  const objectives: SummaryObjective[] = mission.objectives;
  const openQuestions = useMemo(
    () => openSummaryQuestions(requestsQ.data ?? [], mission.id),
    [mission.id, requestsQ.data]
  );
  const runningSentences = useMemo(
    () => missionSummaryRunningSentences(objectives, openQuestions),
    [objectives, openQuestions]
  );
  const state = missionSummarySectionState({
    response,
    isError: summaryQ.isError,
    runningSentences
  });

  const evidence = response?.eligible ? response.evidence : EMPTY_EVIDENCE;
  const summary = response?.eligible ? response.summary : null;
  const deliveryStamps = deliveriesQ.data?.items ?? NO_DELIVERIES;
  const actionRows = useMemo(
    () => missionSummaryActions({ evidence, openQuestions, objectives, baseline }),
    [evidence, openQuestions, objectives, baseline]
  );
  const sources = useMemo(
    () => missionSummarySources(evidence, objectives),
    [evidence, objectives]
  );
  const suggestionRows = useMemo(
    () => (summary ? missionSummarySuggestions({ summary, objectives, baseline }) : []),
    [summary, objectives, baseline]
  );
  const riskRows = useMemo(
    () => (summary ? missionSummaryRisks({ summary, objectives, baseline }) : []),
    [summary, objectives, baseline]
  );
  const files = useMemo(
    () =>
      missionSummaryFiles(fileChangesQ.data?.items ?? [], {
        truncated: (fileChangesQ.data?.total ?? 0) > (fileChangesQ.data?.items.length ?? 0)
      }),
    [fileChangesQ.data]
  );

  const displayed =
    (state.kind === 'summary' || state.kind === 'first_pending') &&
    summaryWatermarkIsDisplayed(response?.watermark ?? null, evidence, openQuestions);
  useAcknowledgeMissionSummary({
    missionId: mission.id,
    response,
    displayed,
    targetRef: sectionRef
  });

  if (state.kind === 'hidden') return null;

  const runningCount = mission.objectives.filter(
    objective => objective.state === 'executing' || objective.state === 'pending_delivery'
  ).length;

  if (state.kind === 'error') {
    return (
      <div className="space-y-3">
        <MissionSummaryHeader generatedAt={null} deliveryCount={null} now={now} />
        <p className="text-sm text-red-400">
          Could not load the mission summary:{' '}
          {(summaryQ.error as Error)?.message ?? 'unknown error'}
        </p>
      </div>
    );
  }

  if (state.kind === 'awaiting') {
    return (
      <div className="space-y-3">
        <MissionSummaryHeader
          generatedAt={null}
          deliveryCount={null}
          runningCount={runningCount}
          now={now}
        />
        <div className="grid gap-1.5 rounded-xl border border-dashed border-(--color-border) bg-(--color-surface-1) px-5 py-4">
          {state.running.length > 0 ? (
            <>
              <p className="text-sm text-(--color-ink)">
                {state.running.join(' ')} The summary appears after its first delivery.
              </p>
              <span className="text-xs text-(--color-ink-dim)">
                Until then, the objectives section above is the full picture.
              </span>
            </>
          ) : (
            <p className="text-sm text-(--color-ink)">
              The summary appears after the first delivery.
            </p>
          )}
        </div>
      </div>
    );
  }

  const updating = state.kind === 'first_pending' || state.updating;
  const sourceObjective = updating
    ? updatingSourceObjective({
        summary,
        evidence,
        deliveries: deliveryStamps,
        objectives
      })
    : null;
  const stripLabel = sourceObjective ? (
    <>
      Updating from the delivery for{' '}
      <span className="font-mono text-xs">{sourceObjective.displayId}</span>
      {sourceObjective.title?.trim() ? `, ${sourceObjective.title.trim()}` : ''}…
    </>
  ) : (
    'Updating the summary…'
  );

  return (
    <div ref={sectionRef} className="space-y-3">
      <MissionSummaryHeader
        generatedAt={summary?.generatedAt ?? null}
        deliveryCount={evidence.totals.currentRunDeliveries}
        runningCount={runningCount}
        now={now}
      />
      <section
        aria-label="Mission summary"
        aria-busy={updating}
        className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-1)"
      >
        <div role="status" aria-live="polite">
          {updating ? <UpdatingStrip label={stripLabel} /> : null}
        </div>
        {state.kind === 'summary' ? (
          <MissionSummaryPost
            headlineId={`mission-summary-headline-${mission.id}`}
            headline={state.summary.headline}
            summary={state.summary.summary}
            runningSentences={runningSentences}
            statusChip={missionSummaryStatusChip(mission.statusType)}
            sources={sources}
            sourcesTruncated={evidence.truncated.sources}
            dimmed={state.updating}
          />
        ) : state.running.length > 0 ? (
          <p className="px-5 py-4 text-sm text-(--color-ink)">{state.running.join(' ')}</p>
        ) : null}
        <MissionSummaryActions
          rows={actionRows}
          totalActions={evidence.totals.actions}
          truncated={evidence.truncated.actions}
        />
        <MissionSummarySuggestions rows={suggestionRows} missionId={mission.id} now={now} />
        {state.kind === 'summary' ? (
          <MissionSummaryRisks rows={riskRows} dimmed={state.updating} />
        ) : null}
        <MissionSummaryFiles files={files} />
        <SummaryFooter />
      </section>
    </div>
  );
}
