import type { DeliveryDto, MissionDetailDto, MissionSummaryEvidenceDto } from '@overlord/contract';
import { CheckCircle2, CircleSlash, Clock, HelpCircle, Loader2, Rocket } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react';

import { formatTimestamp, relativeTime } from '../../lib/format-date.ts';
import {
  useAcknowledgeMissionSummary,
  useEvidenceGroupCoverage,
  useForegroundVisible,
  useMissionSummaryVisitBaseline
} from '../../lib/hooks/use-mission-summary-seen.ts';
import {
  type MissionLiveStatus,
  missionLiveStatus,
  missionSummaryActions,
  missionSummaryClosedItems,
  missionSummaryFiles,
  missionSummaryProvenance,
  missionSummaryRisks,
  missionSummaryRunningSentences,
  missionSummarySectionState,
  missionSummarySuggestions,
  missionSummaryTradeoffs,
  openSummaryQuestions,
  summaryCoverageComplete,
  summaryCoverageRequirements,
  type SummaryEvidenceGroup,
  type SummaryMember,
  type SummaryObjective,
  summaryWatermarkIsDisplayed,
  updatingSourceObjective
} from '../../lib/mission-summary-derive.ts';
import {
  useMissionDeliveries,
  useMissionFileChanges,
  type useMissionOpenAgentRequests,
  useMissionSummary,
  useWorkspaceMembers
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { KindBadge } from '../activity-feed/ActivityFeedCardChrome.tsx';
import { Markdown } from '../Markdown.tsx';
import { MissionSummaryActions } from '../mission-summary/MissionSummaryActions.tsx';
import { MissionSummaryFiles } from '../mission-summary/MissionSummaryFiles.tsx';
import { NewDot } from '../mission-summary/MissionSummaryParts.tsx';
import { MissionSummaryProvenanceLine } from '../mission-summary/MissionSummaryPost.tsx';
import { MissionSummaryResolved } from '../mission-summary/MissionSummaryResolved.tsx';
import { MissionSummaryRisks } from '../mission-summary/MissionSummaryRisks.tsx';
import { MissionSummarySuggestions } from '../mission-summary/MissionSummarySuggestions.tsx';
import { MissionSummaryTradeoffs } from '../mission-summary/MissionSummaryTradeoffs.tsx';
import { StatusSpinner } from '../StatusMotion.tsx';

import { OVERVIEW_TAB_TONES, type OverviewTabTone } from './overview-tab-tones.ts';

type OpenRequests = ReturnType<typeof useMissionOpenAgentRequests>;

export type OverviewTabId = 'objectives' | 'summary' | 'for_you' | 'suggested';

type OverviewTab = {
  id: OverviewTabId;
  label: string;
  count: string;
  tone: OverviewTabTone;
  /** An unread item sits in this tab. */
  hasNew: boolean;
};

/** Tabs whose content is evidence the seen watermark covers. */
const TAB_EVIDENCE_GROUP: Partial<Record<OverviewTabId, SummaryEvidenceGroup>> = {
  for_you: 'for_you',
  // The Summary tab carries the mission's risks alongside the summary prose.
  summary: 'risks',
  suggested: 'suggested'
};

const NO_DELIVERIES: DeliveryDto[] = [];
const NO_MEMBERS: SummaryMember[] = [];
const EMPTY_EVIDENCE: MissionSummaryEvidenceDto = {
  actions: [],
  sources: [],
  totals: { actions: 0, sources: 0, currentRunDeliveries: 0 },
  truncated: { actions: false, sources: false }
};

/** A clock for relative labels, ticking once a minute. */
function useMinuteClock(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The mission's live status, shown apart from the agent-written summary: a labelled badge plus the
 * reason. It is derived from live mission, objective, request and item state (`missionLiveStatus`),
 * so closing the last blocking action or answering the last question changes it on the next
 * refresh, without a delivery. It is a polite live region (a labelled group, so the updating strip stays the only `status`) and the change is announced.
 */
function LiveStatusLine({ status }: { status: MissionLiveStatus }) {
  const badge = (() => {
    switch (status.kind) {
      case 'blocked':
        return (
          <KindBadge
            tone="blocked"
            icon={<CircleSlash className="size-3" aria-hidden="true" />}
            label={status.label}
          />
        );
      case 'waiting':
        return (
          <KindBadge
            tone="question"
            icon={<HelpCircle className="size-3" aria-hidden="true" />}
            label={status.label}
          />
        );
      case 'in_progress':
        return (
          <KindBadge
            tone="running"
            icon={<StatusSpinner className="size-3" />}
            label={status.label}
          />
        );
      case 'launching':
        return (
          <KindBadge
            tone="launching"
            icon={<Rocket className="size-3" aria-hidden="true" />}
            label={status.label}
          />
        );
      case 'complete':
        return (
          <KindBadge
            tone="delivered"
            icon={<CheckCircle2 className="size-3" aria-hidden="true" />}
            label={status.label}
          />
        );
      case 'idle':
        return <KindBadge tone="delivered" icon={null} label={status.label} />;
    }
  })();
  return (
    <div
      role="group"
      aria-live="polite"
      aria-label="Mission status"
      data-live-status={status.kind}
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
    >
      {badge}
      {status.detail ? (
        <span className="min-w-0 text-xs text-(--color-ink-dim) wrap-anywhere">
          {status.detail}
        </span>
      ) : null}
    </div>
  );
}

function UpdatingStrip({ label }: { label: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100">
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <span className="min-w-0 wrap-anywhere">{label}</span>
    </div>
  );
}

function OverviewTabs({
  tabs,
  selected,
  onSelect,
  idFor
}: {
  tabs: readonly OverviewTab[];
  selected: OverviewTabId;
  onSelect: (id: OverviewTabId) => void;
  idFor: (id: OverviewTabId, part: 'tab' | 'panel') => string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(tab => tab.id === selected);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onSelect(tab.id);
    document.getElementById(idFor(tab.id, 'tab'))?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Mission overview"
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-wrap gap-1.5"
    >
      {tabs.map(tab => {
        const isSelected = tab.id === selected;
        const tone = OVERVIEW_TAB_TONES[tab.tone];
        return (
          <button
            key={tab.id}
            id={idFor(tab.id, 'tab')}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-controls={idFor(tab.id, 'panel')}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              isSelected ? tone.selected : tone.idle
            )}
          >
            {tab.hasNew && !isSelected ? <NewDot /> : null}
            <span>{tab.label}</span>
            {tab.count ? <span className="tabular-nums opacity-90">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The mission overview card (mission-panel-redesign plan §6): a feed-style header (context line,
 * state badge, headline, full summary) over a tab row whose selection replaces the lower half.
 * The Objectives tab holds the objective list; the other tabs reuse the summary components
 * headless. The card never hides, because it carries the objective list, so every summary state
 * (ineligible, awaiting, error, first pending/updating, summary) has a header form.
 *
 * Seen acknowledgement is gated by displayed coverage (§6.1): the existing monotonic watermark is
 * acknowledged only once the header and every nonempty evidence tab of the current snapshot have
 * each been on screen, in the foreground and not under the objective dialog, for two seconds.
 * Hidden tabs, loading/partial/failed data and occluded content never count.
 *
 * Mount with `key={mission.id}`: the new-item baseline is frozen per visit and the selected tab
 * returns to Objectives.
 */
export function MissionOverviewCard({
  mission,
  openRequests,
  occluded,
  objectiveList
}: {
  mission: MissionDetailDto;
  /** The shared complete open-request collection (plan §3.1). */
  openRequests: OpenRequests;
  /** The objective detail dialog covers the panel. */
  occluded: boolean;
  /** The objective list (plan §7); stays mounted whichever tab is selected. */
  objectiveList: ReactNode;
}) {
  const summaryQ = useMissionSummary(mission.id);
  const response = summaryQ.data;
  const eligible = response?.eligible === true;
  const deliveriesQ = useMissionDeliveries(mission.id, eligible);
  const fileChangesQ = useMissionFileChanges(mission.id);
  const membersQ = useWorkspaceMembers(eligible ? mission.workspaceId : null);
  const members = membersQ.data ?? NO_MEMBERS;
  const baseline = useMissionSummaryVisitBaseline(response) ?? null;
  const now = useMinuteClock();
  const baseId = useId();
  const headerRef = useRef<HTMLDivElement>(null);
  const lowerRef = useRef<HTMLDivElement>(null);

  const objectives: SummaryObjective[] = mission.objectives;
  // For you is derived from the complete open-request collection, independent of summary
  // eligibility (plan §6.2, decision 13), so older missions still list their open questions.
  const openQuestions = useMemo(
    () => openSummaryQuestions(openRequests.requests, mission.id),
    [mission.id, openRequests.requests]
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
  const evidence = response?.eligible ? (response.evidence ?? EMPTY_EVIDENCE) : EMPTY_EVIDENCE;
  const summary = response?.eligible ? response.summary : null;
  const summaryStable = !summaryQ.isError;

  const actionRows = useMemo(
    () => missionSummaryActions({ evidence, openQuestions, objectives, baseline }),
    [evidence, openQuestions, objectives, baseline]
  );
  const suggestionRows = useMemo(
    () => (summary ? missionSummarySuggestions({ summary, objectives, baseline }) : []),
    [summary, objectives, baseline]
  );
  const riskRows = useMemo(
    () =>
      summary && state.kind === 'summary'
        ? missionSummaryRisks({ summary, objectives, baseline })
        : [],
    [summary, objectives, baseline, state.kind]
  );
  const closedRows = useMemo(
    () => (summary ? missionSummaryClosedItems({ summary, objectives, members }) : []),
    [summary, objectives, members]
  );
  const tradeoffRows = useMemo(
    () =>
      missionSummaryTradeoffs({
        deliveries: deliveriesQ.data?.items ?? NO_DELIVERIES,
        objectives
      }),
    [deliveriesQ.data, objectives]
  );
  const provenance = useMemo(
    () => (summary ? missionSummaryProvenance(summary, objectives) : null),
    [summary, objectives]
  );
  const files = useMemo(
    () =>
      missionSummaryFiles(fileChangesQ.data?.items ?? [], {
        truncated: (fileChangesQ.data?.total ?? 0) > (fileChangesQ.data?.items.length ?? 0)
      }),
    [fileChangesQ.data]
  );

  // ---- Tabs ----
  const completedCount = mission.objectives.filter(o => o.state === 'complete').length;
  const showSummaryTabs = eligible && state.kind !== 'error';
  const tabs: OverviewTab[] = [
    {
      id: 'objectives',
      label: 'Objectives',
      count: `${completedCount}/${mission.objectives.length}`,
      tone: 'ink',
      hasNew: false
    }
  ];
  // Summary holds the summary prose plus the risks, tradeoffs, resolved items (decisions) and
  // files.
  const showRisks = showSummaryTabs && riskRows.length > 0;
  const showTradeoffs = showSummaryTabs && tradeoffRows.length > 0;
  const showResolved = showSummaryTabs && closedRows.length > 0;
  const showFiles = showSummaryTabs && files.total > 0;
  if (state.kind === 'summary' || showRisks || showTradeoffs || showResolved || showFiles) {
    tabs.push({
      id: 'summary',
      label: 'Summary',
      count: '',
      tone: 'grey',
      hasNew: riskRows.some(row => row.isNew)
    });
  }
  if (actionRows.length > 0) {
    tabs.push({
      id: 'for_you',
      label: 'For you',
      count: String(actionRows.length),
      tone: 'sky',
      hasNew: actionRows.some(row => row.isNew)
    });
  }
  if (showSummaryTabs && suggestionRows.length > 0) {
    tabs.push({
      id: 'suggested',
      label: 'Suggested',
      count: String(suggestionRows.length),
      tone: 'violet',
      hasNew: suggestionRows.some(row => row.isNew)
    });
  }
  const [requestedTab, setRequestedTab] = useState<OverviewTabId>('objectives');
  // A tab whose count dropped to zero disappears; selection then returns to Objectives.
  const selectedTab: OverviewTabId = tabs.some(tab => tab.id === requestedTab)
    ? requestedTab
    : 'objectives';
  useEffect(() => {
    if (selectedTab !== requestedTab) setRequestedTab(selectedTab);
  }, [requestedTab, selectedTab]);
  const idFor = useCallback(
    (id: OverviewTabId, part: 'tab' | 'panel') => `${baseId}-${part}-${id}`,
    [baseId]
  );

  // ---- Displayed-evidence coverage and acknowledgement (plan §6.1) ----
  const requestsComplete = openRequests.authoritative;
  const required = useMemo(
    () => summaryCoverageRequirements({ actionRows, riskRows, suggestionRows }),
    [actionRows, riskRows, suggestionRows]
  );
  const [covered, setCovered] = useState<Record<string, string>>({});
  const markCovered = useCallback((group: string, signature: string) => {
    setCovered(current =>
      current[group] === signature ? current : { ...current, [group]: signature }
    );
  }, []);
  const headerVisible = useForegroundVisible(headerRef, true);
  const lowerVisible = useForegroundVisible(lowerRef, true);
  const selectedGroup = TAB_EVIDENCE_GROUP[selectedTab] ?? null;
  // For you mixes summary evidence with open questions, so it counts only when both are
  // complete; Summary (its risks) and Suggested need a successfully loaded summary.
  const selectedGroupReady =
    selectedGroup === 'for_you'
      ? requestsComplete && summaryStable
      : summaryStable && state.kind === 'summary';
  useEvidenceGroupCoverage({
    group: selectedGroup,
    signature: selectedGroup ? (required[selectedGroup] ?? null) : null,
    active: selectedGroupReady && lowerVisible && !occluded,
    onCovered: markCovered
  });
  const displayed =
    (state.kind === 'summary' || state.kind === 'first_pending') &&
    summaryStable &&
    requestsComplete &&
    summaryWatermarkIsDisplayed(response?.watermark ?? null, evidence, openQuestions);
  useAcknowledgeMissionSummary({
    missionId: mission.id,
    response,
    displayed,
    visible: headerVisible && !occluded,
    coverageComplete: summaryCoverageComplete(required, covered)
  });

  // ---- Header ----
  const liveStatus = useMemo(
    () =>
      missionLiveStatus({
        statusType: mission.statusType,
        objectives,
        openQuestions,
        actionRows
      }),
    [mission.statusType, objectives, openQuestions, actionRows]
  );
  const updating = state.kind === 'first_pending' || (state.kind === 'summary' && state.updating);
  const sourceObjective = updating
    ? updatingSourceObjective({
        summary,
        evidence,
        deliveries: deliveriesQ.data?.items ?? NO_DELIVERIES,
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
  const headline =
    state.kind === 'summary' && state.summary.headline.trim()
      ? state.summary.headline.trim()
      : mission.title;
  const generatedAt = summary?.generatedAt ?? null;

  return (
    <section
      aria-label="Mission summary"
      aria-busy={updating}
      data-mission-overview=""
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-(--color-border) bg-background"
    >
      <div role="status" aria-live="polite">
        {updating ? <UpdatingStrip label={stripLabel} /> : null}
      </div>
      <div className="grid min-w-0 gap-2 px-4 pt-4">
        {openRequests.state === 'error' || openRequests.state === 'partial' ? (
          // Never imply questions are gone: the last successful list stays, with a retry.
          <p
            role="alert"
            className="flex flex-wrap items-center gap-x-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <span>
              {openRequests.state === 'error'
                ? 'Could not refresh open questions; showing the last ones loaded.'
                : 'Some open questions may not be listed.'}
            </span>
            <button
              type="button"
              onClick={() => void openRequests.retry()}
              className="rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2"
            >
              Retry
            </button>
          </p>
        ) : null}
        <LiveStatusLine status={liveStatus} />
        <OverviewTabs tabs={tabs} selected={selectedTab} onSelect={setRequestedTab} idFor={idFor} />
      </div>

      <div ref={lowerRef} className="min-w-0 bg-background">
        {/* Objectives stays mounted on every tab: its rows own reorder state and row order. */}
        <div
          role="tabpanel"
          id={idFor('objectives', 'panel')}
          aria-labelledby={idFor('objectives', 'tab')}
          hidden={selectedTab !== 'objectives'}
          className="min-w-0 py-1"
        >
          {objectiveList}
        </div>
        {selectedTab !== 'objectives' ? (
          <div
            role="tabpanel"
            id={idFor(selectedTab, 'panel')}
            aria-labelledby={idFor(selectedTab, 'tab')}
            tabIndex={0}
            className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {selectedTab === 'summary' ? (
              <>
                <div ref={headerRef} className="grid min-w-0 gap-2 p-4">
                  {state.kind === 'summary' ? (
                    <>
                      {generatedAt ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-(--color-ink-dim)">
                          <span
                            className="inline-flex items-center gap-1"
                            title={formatTimestamp(generatedAt)}
                          >
                            <Clock className="size-3" aria-hidden="true" />
                            Summary updated{' '}
                            {relativeTime(generatedAt, now, { immediate: 'just now' })}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex min-w-0 items-center gap-2">
                        <h2
                          id={`mission-summary-headline-${mission.id}`}
                          className={cn(
                            'min-w-0 flex-1 truncate text-base font-semibold text-(--color-ink)',
                            state.updating && 'opacity-55'
                          )}
                          title={headline}
                        >
                          {headline}
                        </h2>
                      </div>
                      <div
                        className={cn(
                          'grid min-w-0 gap-1 text-sm text-(--color-ink)',
                          state.updating && 'opacity-55'
                        )}
                      >
                        {state.summary.summary.trim() ? (
                          <Markdown text={state.summary.summary} />
                        ) : null}
                      </div>
                      <MissionSummaryProvenanceLine
                        provenance={provenance ?? { kind: 'automatic' }}
                      />
                    </>
                  ) : state.kind === 'error' ? (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      Could not load the mission summary:{' '}
                      {(summaryQ.error as Error)?.message ?? 'unknown error'}
                    </p>
                  ) : null}
                </div>
                {showRisks ? (
                  <MissionSummaryRisks
                    rows={riskRows}
                    missionId={mission.id}
                    dimmed={state.kind === 'summary' && state.updating}
                  />
                ) : null}
                {showTradeoffs ? (
                  <MissionSummaryTradeoffs
                    rows={tradeoffRows}
                    dimmed={state.kind === 'summary' && state.updating}
                  />
                ) : null}
                {showResolved ? (
                  <MissionSummaryResolved rows={closedRows} missionId={mission.id} now={now} />
                ) : null}
                {showFiles ? (
                  <MissionSummaryFiles files={files} projectId={mission.projectId} />
                ) : null}
              </>
            ) : selectedTab === 'for_you' ? (
              <MissionSummaryActions
                headless
                rows={actionRows}
                missionId={mission.id}
                totalActions={evidence.totals.actions}
                truncated={evidence.truncated.actions}
              />
            ) : selectedTab === 'suggested' ? (
              <MissionSummarySuggestions
                headless
                rows={suggestionRows}
                missionId={mission.id}
                now={now}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
