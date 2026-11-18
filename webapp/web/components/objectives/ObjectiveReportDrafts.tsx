import type { ObjectiveDto, ReportDraftDto, ReportDraftEntryDto } from '@overlord/contract';
import { ChevronDown, Import } from 'lucide-react';
import { useState } from 'react';

import { formatDateTime } from '../../lib/format-date.ts';
import {
  activeEntryCount,
  describeReportDraftEntry,
  orderReportDrafts,
  REPORT_DRAFTS_SECTION_LABEL,
  REPORT_DRAFTS_SECTION_NOTE,
  reportDraftEntryOutcome,
  type ReportDraftState,
  reportDraftStateCopy,
  shortSessionId,
  withdrawnEntries
} from '../../lib/objective-report-drafts.ts';
import { useObjectiveReportDrafts } from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { HumanActionDetails } from '../HumanActionDetails.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx';

import { ObjectiveEvidenceEmpty, ObjectiveEvidenceSection } from './ObjectiveEvidenceRule.tsx';

const STATE_BADGE: Record<ReportDraftState, string> = {
  open: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  abandoned: 'border-(--color-border) bg-(--color-surface-2) text-(--color-ink-dim)',
  sealed: 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200'
};

function ProvisionalTag() {
  return (
    <span className="rounded-sm border border-dashed border-amber-500/50 px-1 py-px font-mono text-[9px] tracking-normal text-amber-700 normal-case dark:text-amber-300">
      provisional
    </span>
  );
}

function DraftEntry({ entry, state }: { entry: ReportDraftEntryDto; state: ReportDraftState }) {
  const view = describeReportDraftEntry(entry);
  const outcome = reportDraftEntryOutcome(state, entry);
  return (
    <li className="grid min-w-0 gap-0.5 text-xs leading-snug" data-entry-id={view.entryId}>
      <p className="min-w-0 wrap-anywhere">
        <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wide text-(--color-ink-dim)">
          {view.kindLabel}
        </span>
        <span className="text-(--color-ink)">{view.title}</span>
      </p>
      {view.details.map(line => (
        <p
          key={`${line.label ?? ''}:${line.text}`}
          className="min-w-0 wrap-anywhere text-(--color-ink-dim)"
        >
          {line.label ? <span className="font-semibold">{line.label}:</span> : null} {line.text}
        </p>
      ))}
      {view.humanActionFields ? <HumanActionDetails action={view.humanActionFields} /> : null}
      {view.importedFrom ? (
        <p className="inline-flex items-center gap-1 text-[11px] text-(--color-ink-dim)">
          <Import className="size-3 shrink-0" aria-hidden="true" />
          Imported from an abandoned draft
        </p>
      ) : null}
      {view.withdrawnReason !== null || view.withdrawnAt !== null ? (
        <p className="text-[11px] text-(--color-ink-dim)">
          Withdrawn {formatDateTime(view.withdrawnAt)}
          {view.withdrawnReason ? `: ${view.withdrawnReason}` : ''}
        </p>
      ) : null}
      {outcome ? <p className="text-[11px] text-(--color-ink-dim)">{outcome}</p> : null}
    </li>
  );
}

function WithdrawnObservations({ draft }: { draft: ReportDraftDto }) {
  const [open, setOpen] = useState(false);
  const withdrawn = withdrawnEntries(draft);
  const count = Math.max(withdrawn.length, draft.withdrawnCount);
  if (count === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-(--color-ink-dim) outline-none hover:text-(--color-ink)">
        <ChevronDown
          className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')}
          aria-hidden="true"
        />
        Withdrawn observations · {count}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        {withdrawn.length > 0 ? (
          <ul className="grid min-w-0 gap-1.5 border-l border-dashed border-(--color-border) pl-2 opacity-80">
            {withdrawn.map(entry => (
              <DraftEntry key={entry.entryId} entry={entry} state={draft.state} />
            ))}
          </ul>
        ) : (
          <ObjectiveEvidenceEmpty>
            Withdrawn observations are not included in this read.
          </ObjectiveEvidenceEmpty>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * One draft (one protocol session). Live drafts open; abandoned and sealed ones
 * start as a compact row so they never crowd out what is happening now.
 */
function DraftBlock({ draft }: { draft: ReportDraftDto }) {
  const [open, setOpen] = useState(draft.state === 'open');
  const copy = reportDraftStateCopy(draft.state);
  const active = activeEntryCount(draft);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <div
        className="rounded-md border border-dashed border-(--color-border) bg-(--color-surface-2)/40"
        data-draft-state={draft.state}
      >
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs outline-none hover:bg-(--color-surface-2)">
          <span
            className={cn(
              'shrink-0 rounded-sm border px-1.5 py-px text-[10px] font-medium',
              STATE_BADGE[draft.state]
            )}
          >
            {copy.label}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--color-ink-dim)">
            <span title={draft.sessionId}>Session {shortSessionId(draft.sessionId)}</span>
            {' · '}
            {active} {active === 1 ? 'observation' : 'observations'}
            {' · updated '}
            {formatDateTime(draft.updatedAt)}
          </span>
          <ChevronDown
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid min-w-0 gap-2 px-3 pb-3">
          <p className="text-[11px] text-(--color-ink-dim)">{copy.description}</p>
          {active > 0 ? (
            <ul className="grid min-w-0 gap-1.5">
              {draft.entries.map(entry => (
                <DraftEntry key={entry.entryId} entry={entry} state={draft.state} />
              ))}
            </ul>
          ) : (
            <ObjectiveEvidenceEmpty>No active observations.</ObjectiveEvidenceEmpty>
          )}
          <WithdrawnObservations draft={draft} />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/** The loaded body: an honest empty state, or every draft in display order. */
export function ObjectiveReportDraftsBody({ drafts }: { drafts: readonly ReportDraftDto[] }) {
  if (drafts.length === 0) {
    return (
      <ObjectiveEvidenceEmpty>
        No draft evidence was recorded for this objective.
      </ObjectiveEvidenceEmpty>
    );
  }
  return (
    <div className="grid min-w-0 gap-1.5">
      <p className="text-[11px] text-(--color-ink-dim)">{REPORT_DRAFTS_SECTION_NOTE}</p>
      {orderReportDrafts(drafts).map(draft => (
        <DraftBlock key={draft.id} draft={draft} />
      ))}
    </div>
  );
}

/** Mounted only inside the opened section, so the read is lazy. */
function ObjectiveReportDraftsLoader({ objectiveId }: { objectiveId: string }) {
  const query = useObjectiveReportDrafts(objectiveId);
  if (query.isLoading)
    return <ObjectiveEvidenceEmpty>Loading draft evidence…</ObjectiveEvidenceEmpty>;
  if (query.isError || !query.data) {
    return (
      <p className="py-1 text-xs text-red-400" role="alert">
        Could not load draft evidence: {(query.error as Error | null)?.message ?? 'unknown error'}
      </p>
    );
  }
  return <ObjectiveReportDraftsBody drafts={query.data.drafts} />;
}

/**
 * Read-only provisional draft evidence for one objective (ADR 0078, plan
 * §7.3). Collapsed by default and fetched only once opened; a closed section
 * makes no request. `delivery_report_draft` and `agent_session` entity changes
 * refresh the objective-scoped read. Nothing here feeds mission badges, human
 * obligations, promotion, seen state or objective completion, and there is no
 * editing or import control.
 */
export function ObjectiveReportDrafts({ objective }: { objective: Pick<ObjectiveDto, 'id'> }) {
  return (
    <ObjectiveEvidenceSection label={REPORT_DRAFTS_SECTION_LABEL} trailing={<ProvisionalTag />}>
      <ObjectiveReportDraftsLoader objectiveId={objective.id} />
    </ObjectiveEvidenceSection>
  );
}
