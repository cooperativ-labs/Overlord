import type {
  DeliveryDto,
  MissionDetailDto,
  MissionSummaryEvidenceDto,
  ObjectiveDto
} from '@overlord/contract';
import { CheckCircle2, Clock, HelpCircle, Loader2, Rocket } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
  missionSummaryActions,
  missionSummaryClosedItems,
  missionSummaryFiles,
  missionSummaryProvenance,
  missionSummaryRisks,
  missionSummaryRunningSentences,
  missionSummarySectionState,
  missionSummarySuggestions,
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
import { isInFlightObjective } from '../objectives/ObjectiveRow.tsx';
import { StatusSpinner } from '../StatusMotion.tsx';

import { OVERVIEW_TAB_TONES, type OverviewTabTone } from './overview-tab-tones.ts';

type OpenRequests = ReturnType<typeof useMissionOpenAgentRequests>;

export type OverviewTabId =
  | 'objectives'
  | 'summary'
  | 'for_you'
  | 'risks'
  | 'suggested'
  | 'resolved'
  | 'files';

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
  risks: 'risks',
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

export type OverviewBadge = 'waiting' | 'executing' | 'launching' | 'complete' | null;

/**
 * The card's state badge (plan §6.1): waiting on you when any objective is blocked, otherwise
 * executing while one is in flight, launching while one launches, complete when the mission's
 * status type is complete, and nothing otherwise.
 */
export function overviewBadge({
  objectives,
  blockingByObjective,
  statusType
}: {
  objectives: readonly Pick<ObjectiveDto, 'id' | 'state'>[];
  blockingByObjective: ReadonlyMap<string, readonly unknown[]>;
  statusType: MissionDetailDto['statusType'];
}): OverviewBadge {
  const inFlight = objectives.filter(objective => isInFlightObjective(objective.state));
  if (inFlight.some(objective => (blockingByObjective.get(objective.id)?.length ?? 0) > 0)) {
    return 'waiting';
  }
  if (inFlight.length > 0) return 'executing';
  if (objectives.some(objective => objective.state === 'launching')) return 'launching';
  if (statusType === 'complete') return 'complete';
  return null;
}

function OverviewKindBadge({ badge }: { badge: OverviewBadge }) {
  if (badge === 'waiting') {
    return (
      <KindBadge
        tone="question"
        icon={<HelpCircle className="size-3" aria-hidden="true" />}
        label="waiting on you"
      />
    );
  }
  if (badge === 'executing') {
    return (
      <KindBadge tone="running" icon={<StatusSpinner className="size-3" />} label="executing" />
    );
  }
  if (badge === 'launching') {
    return (
      <KindBadge
        tone="launching"
        icon={<Rocket className="size-3" aria-hidden="true" />}
        label="launching"
      />
    );
  }
  if (badge === 'complete') {
    return (
      <KindBadge
        tone="delivered"
        icon={<CheckCircle2 className="size-3" aria-hidden="true" />}
        label="complete"
      />
    );
  }
  return null;
}

function UpdatingStrip({ label }: { label: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100">
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <span className="min-w-0 wrap-anywhere">{label}</span>
    </div>
  );
}

/** The summary paragraph, clamped to three lines with Show more (plan §6.1). */
function ClampedSummary({ children, dimmed }: { children: ReactNode; dimmed: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node || expanded) return;
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children, expanded]);
  return (
    <div className={cn('grid min-w-0 gap-1', dimmed && 'opacity-55')}>
      <div
        id={bodyId}
        ref={bodyRef}
        className={cn(
          'min-w-0 text-sm text-(--color-ink)',
          // Markdown contains block layouts, which Chromium does not always line-clamp.
          !expanded && 'line-clamp-3 max-h-[3lh] overflow-hidden'
        )}
      >
        {children}
      </div>
      {overflowing || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(value => !value)}
          className="w-fit rounded-sm text-xs font-medium text-(--color-ink-dim) hover:text-(--color-ink) hover:underline focus-visible:outline-2"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
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
 * state badge, headline, clamped summary) over a tab row whose selection replaces the lower half.
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
  if (state.kind === 'summary') {
    tabs.push({ id: 'summary', label: 'Summary', count: '', tone: 'grey', hasNew: false });
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
  if (showSummaryTabs && riskRows.length > 0) {
    tabs.push({
      id: 'risks',
      label: 'Risks',
      count: String(riskRows.length),
      tone: 'red',
      hasNew: riskRows.some(row => row.isNew)
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
  if (showSummaryTabs && closedRows.length > 0) {
    tabs.push({
      id: 'resolved',
      label: 'Resolved',
      count: String(closedRows.length),
      tone: 'grey',
      hasNew: false
    });
  }
  if (showSummaryTabs && files.total > 0) {
    tabs.push({
      id: 'files',
      label: 'Files',
      count: `${files.total}${files.truncated ? '+' : ''}`,
      tone: 'grey',
      hasNew: false
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
  // complete; Risks and Suggested need a successfully loaded summary.
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
  const badge = overviewBadge({
    objectives: mission.objectives,
    blockingByObjective: openRequests.blockingByObjective,
    statusType: mission.statusType
  });
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
                      <OverviewKindBadge badge={badge} />
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
                    <ClampedSummary dimmed={state.updating}>
                      {state.summary.summary.trim() ? (
                        <Markdown text={state.summary.summary} />
                      ) : null}
                      {runningSentences.length > 0 ? <p>{runningSentences.join(' ')}</p> : null}
                    </ClampedSummary>
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
            ) : selectedTab === 'for_you' ? (
              <MissionSummaryActions
                headless
                rows={actionRows}
                missionId={mission.id}
                totalActions={evidence.totals.actions}
                truncated={evidence.truncated.actions}
              />
            ) : selectedTab === 'risks' ? (
              <MissionSummaryRisks
                headless
                rows={riskRows}
                missionId={mission.id}
                dimmed={state.kind === 'summary' && state.updating}
              />
            ) : selectedTab === 'suggested' ? (
              <MissionSummarySuggestions
                headless
                rows={suggestionRows}
                missionId={mission.id}
                now={now}
              />
            ) : selectedTab === 'resolved' ? (
              <MissionSummaryResolved headless rows={closedRows} missionId={mission.id} now={now} />
            ) : selectedTab === 'files' ? (
              <MissionSummaryFiles headless files={files} projectId={mission.projectId} />
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
