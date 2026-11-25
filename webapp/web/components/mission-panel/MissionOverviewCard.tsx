import type { DeliveryDto, MissionDetailDto, MissionSummaryEvidenceDto } from '@overlord/contract';
import { CheckCircle2, CircleSlash, Clock, HelpCircle, History, Rocket } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
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
  missionSummaryRisks,
  missionSummaryRunningSentences,
  missionSummarySectionState,
  missionSummarySuggestions,
  missionSummaryTradeoffs,
  NARRATIVE_LEGACY_LABEL,
  openSummaryQuestions,
  responseItemsWatermark,
  responseNarrativeWatermark,
  summaryAcknowledgement,
  summaryCoverageRequirements,
  type SummaryEvidenceGroup,
  summaryItemsSignature,
  type SummaryMember,
  summaryNarrativeIsNew,
  summaryNarrativeSignature,
  type SummaryNarrativeView,
  type SummaryObjective
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
import { NewDot, ObjectiveKeyLink } from '../mission-summary/MissionSummaryParts.tsx';
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
 * refresh, without a delivery. It is a polite live region (a labelled group) and the change is
 * announced.
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

/**
 * The summary header (plan §5.4, ADR 0076): agent prose with its recorded author, or a plain
 * notice that accepted work has no summary. Outdated prose says the latest delivery is not
 * covered; legacy prose is labelled as an earlier summary with its actual provenance. Nothing here
 * waits for or promises an automatic update: no writer exists. The newest accepted work is linked
 * so it can be read without the prose.
 */
function NarrativeHeader({
  view,
  missionId,
  missionTitle,
  now,
  isNew,
  headerRef
}: {
  view: SummaryNarrativeView;
  missionId: string;
  missionTitle: string;
  now: string;
  /** The header carries a narrative change newer than the visit baseline. */
  isNew: boolean;
  headerRef: RefObject<HTMLDivElement | null>;
}) {
  const headline = view.headline || missionTitle;
  const latest = view.latestWork;
  return (
    <div ref={headerRef} data-narrative-state={view.freshness} className="grid min-w-0 gap-2 p-4">
      {view.hasProse ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-(--color-ink-dim)">
          {isNew ? <NewDot /> : null}
          {view.legacy ? (
            <span className="inline-flex items-center gap-1 font-medium">
              <History className="size-3" aria-hidden="true" />
              {NARRATIVE_LEGACY_LABEL}
            </span>
          ) : null}
          {view.writtenAt ? (
            <span
              className="inline-flex items-center gap-1"
              title={formatTimestamp(view.writtenAt)}
            >
              {view.legacy ? null : <Clock className="size-3" aria-hidden="true" />}
              {view.legacy ? 'Written' : 'Summary updated'}{' '}
              {relativeTime(view.writtenAt, now, { immediate: 'just now' })}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        {!view.hasProse && isNew ? <NewDot /> : null}
        <h2
          id={`mission-summary-headline-${missionId}`}
          className="min-w-0 flex-1 truncate text-base font-semibold text-(--color-ink)"
          title={headline}
        >
          {headline}
        </h2>
      </div>
      {view.hasProse && view.summary.trim() ? (
        <div className="grid min-w-0 gap-1 text-sm text-(--color-ink)">
          <Markdown text={view.summary} />
        </div>
      ) : null}
      {view.notice ? (
        <p
          data-narrative-notice=""
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-amber-800 dark:text-amber-200"
        >
          <span className="font-medium">{view.notice}.</span>
          {latest ? (
            <>
              <span>Latest delivery:</span>
              <ObjectiveKeyLink
                objectiveKey={latest.objectiveKey}
                ariaLabel={
                  latest.objectiveKey
                    ? `Open objective ${latest.objectiveKey}, the latest accepted delivery`
                    : undefined
                }
              />
              <span title={formatTimestamp(latest.deliveredAt)}>
                {relativeTime(latest.deliveredAt, now, { immediate: 'just now' })}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
      {view.provenance ? (
        <MissionSummaryProvenanceLine provenance={view.provenance} legacy={view.legacy} />
      ) : null}
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
 * (ineligible, awaiting, error, summary) has a header form. The summary header shows only what is
 * true now: agent prose and its freshness, or that accepted work has no summary (ADR 0076).
 *
 * Seen acknowledgement is gated by displayed coverage (§6.1, review R2): the one scalar seen marker
 * advances to the response's combined watermark (deliveries/questions and narrative) only once the
 * summary header and every nonempty evidence tab of that same response have each been on screen,
 * in the foreground and not under the objective dialog, for two seconds with their current
 * content. Hidden tabs, loading/partial/failed data and occluded content never count, so a newer
 * visible group never acknowledges an older hidden one, across remounts and cold reads.
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
    runningSentences,
    objectives
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
  // Risks and other items are live state, independent of whether any prose exists.
  const riskRows = useMemo(
    () => (summary ? missionSummaryRisks({ summary, objectives, baseline }) : []),
    [summary, objectives, baseline]
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
  const files = useMemo(
    () =>
      missionSummaryFiles(fileChangesQ.data?.items ?? [], {
        truncated: (fileChangesQ.data?.total ?? 0) > (fileChangesQ.data?.items.length ?? 0)
      }),
    [fileChangesQ.data]
  );

  const itemsWatermark = responseItemsWatermark(response);
  const itemsIsNew =
    itemsWatermark !== null &&
    (baseline === null ||
      (baseline !== undefined && Date.parse(itemsWatermark) > Date.parse(baseline)));
  const narrativeWatermark = responseNarrativeWatermark(response);
  const narrativeIsNew =
    state.kind === 'summary' && summaryNarrativeIsNew(narrativeWatermark, baseline);

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
      hasNew: riskRows.some(row => row.isNew) || narrativeIsNew || itemsIsNew
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

  // ---- Displayed-evidence coverage and acknowledgement (plan §6.1, ADR 0076 / review R2) ----
  const requestsComplete = openRequests.authoritative;
  const narrativeSignature = useMemo(
    () => summaryNarrativeSignature(response, state.kind === 'summary' ? state.narrative : null),
    [response, state]
  );
  const itemsSignature = useMemo(
    () => summaryItemsSignature(summary, itemsWatermark),
    [summary, itemsWatermark]
  );
  const required = useMemo(
    () =>
      summaryCoverageRequirements({
        actionRows,
        riskRows,
        suggestionRows,
        narrativeSignature,
        itemsSignature
      }),
    [actionRows, riskRows, suggestionRows, narrativeSignature, itemsSignature]
  );
  const [covered, setCovered] = useState<Record<string, string>>({});
  const markCovered = useCallback((group: string, signature: string) => {
    setCovered(current =>
      current[group] === signature ? current : { ...current, [group]: signature }
    );
  }, []);
  const [coveredItems, setCoveredItems] = useState<Record<string, string>>({});
  const markItemCovered = useCallback((id: string, signature: string) => {
    setCoveredItems(current =>
      current[id] === signature ? current : { ...current, [id]: signature }
    );
  }, []);
  useEffect(() => {
    const rows = summary?.closedItems.filter(item => item.resolvedBy?.crossMission) ?? [];
    if (
      itemsSignature &&
      rows.length &&
      rows.every(item => coveredItems[item.id] === itemsSignature)
    ) {
      markCovered('items', itemsSignature);
    }
  }, [summary, itemsSignature, coveredItems, markCovered]);
  // The header exists only while the Summary tab is selected; observe it from then on.
  const headerVisible = useForegroundVisible(headerRef, selectedTab === 'summary');
  const lowerVisible = useForegroundVisible(lowerRef, true);
  const selectedGroup = TAB_EVIDENCE_GROUP[selectedTab] ?? null;
  const summaryLoaded = summaryStable && response?.eligible === true;
  // For you mixes summary evidence with open questions, so it counts only when both are
  // complete; Summary (its risks) and Suggested need a successfully loaded summary.
  const selectedGroupReady =
    selectedGroup === 'for_you' ? requestsComplete && summaryLoaded : summaryLoaded;
  useEvidenceGroupCoverage({
    group: selectedGroup,
    signature: selectedGroup ? (required[selectedGroup] ?? null) : null,
    active: selectedGroupReady && lowerVisible && !occluded,
    onCovered: markCovered
  });
  // The summary header (prose or notice) is its own group: seeing the risks below it, or any other
  // tab, never stands in for it.
  useEvidenceGroupCoverage({
    group: 'narrative',
    signature: required.narrative ?? null,
    active: summaryLoaded && selectedTab === 'summary' && headerVisible && !occluded,
    onCovered: markCovered
  });
  const acknowledgement = summaryAcknowledgement({
    watermark: response?.eligible ? response.watermark : null,
    narrativeWatermark,
    itemsWatermark,
    seenAt: response?.eligible ? response.seenAt : null,
    evidence,
    questions: openQuestions,
    required,
    covered,
    loaded: summaryLoaded && requestsComplete && !response?.itemsTruncated
  });
  useAcknowledgeMissionSummary({
    missionId: mission.id,
    target: acknowledgement.target,
    due: acknowledgement.due,
    visible: lowerVisible && !occluded
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
  return (
    <section
      aria-label="Mission summary"
      data-mission-overview=""
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-(--color-border) bg-background"
    >
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
                {state.kind === 'summary' ? (
                  <NarrativeHeader
                    view={state.narrative}
                    missionId={mission.id}
                    missionTitle={mission.title}
                    now={now}
                    isNew={narrativeIsNew}
                    headerRef={headerRef}
                  />
                ) : state.kind === 'error' ? (
                  <p className="p-4 text-sm text-red-600 dark:text-red-400">
                    Could not load the mission summary:{' '}
                    {(summaryQ.error as Error)?.message ?? 'unknown error'}
                  </p>
                ) : null}
                {showRisks ? <MissionSummaryRisks rows={riskRows} missionId={mission.id} /> : null}
                {showTradeoffs ? <MissionSummaryTradeoffs rows={tradeoffRows} /> : null}
                {showResolved ? (
                  <MissionSummaryResolved
                    rows={closedRows}
                    missionId={mission.id}
                    now={now}
                    isNew={itemsIsNew}
                    truncated={response?.itemsTruncated ?? false}
                    coverage={
                      itemsSignature
                        ? {
                            active: summaryLoaded && !occluded,
                            signature: itemsSignature,
                            onCovered: markItemCovered
                          }
                        : undefined
                    }
                  />
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
