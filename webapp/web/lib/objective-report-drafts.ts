import type { ReportDraftDto, ReportDraftEntryDto, ReportDraftKind } from '@overlord/contract';

/**
 * Presentation model for an objective's provisional draft evidence (ADR 0078,
 * delivery-process plan §7.3). Pure so the wording that keeps tentative
 * evidence from reading as accepted work is tested once.
 *
 * Draft evidence is never a mission item, risk, action, suggestion, human
 * obligation, promotion source, seen-state input or completion signal. Nothing
 * here reads or writes any of those, and the copy never calls an entry
 * accepted, blocking or required.
 */

export const REPORT_DRAFTS_SECTION_LABEL = 'Draft evidence — not delivered';

export const REPORT_DRAFTS_SECTION_NOTE =
  'Observations agents recorded while working. They are provisional: they are not part of any ' +
  'delivery, create no mission items or obligations, and cannot be edited here.';

export type ReportDraftState = ReportDraftDto['state'];

export interface ReportDraftStateCopy {
  /** Short badge text. */
  label: string;
  /** One sentence saying what the state means for these observations. */
  description: string;
}

const STATE_COPY: Record<ReportDraftState, ReportDraftStateCopy> = {
  open: {
    label: 'Recording',
    description:
      'This execution is still running and has not delivered. These observations may change or be withdrawn.'
  },
  abandoned: {
    label: 'Abandoned',
    description:
      'This session ended without delivering. These observations were never accepted; a later execution may import them explicitly.'
  },
  sealed: {
    label: 'Sealed by delivery',
    description:
      'An accepted delivery sealed this draft. Its delivery card shows the accepted report; these are the provisional observations it was assembled from.'
  }
};

export function reportDraftStateCopy(state: ReportDraftState): ReportDraftStateCopy {
  return STATE_COPY[state];
}

const KIND_LABEL: Record<ReportDraftKind, string> = {
  human_action: 'Human action',
  tradeoff: 'Tradeoff',
  known_risk: 'Known risk',
  deferred_work: 'Deferred work',
  assumption: 'Assumption'
};

export function reportDraftKindLabel(kind: ReportDraftKind): string {
  return KIND_LABEL[kind] ?? kind;
}

/** A labeled supporting line under an entry's title. */
export interface ReportDraftEntryDetail {
  label: string | null;
  text: string;
}

export interface ReportDraftEntryView {
  entryId: string;
  kind: ReportDraftKind;
  kindLabel: string;
  title: string;
  details: ReportDraftEntryDetail[];
  /** Optional human-action command/verify/link fields, rendered verbatim. */
  humanActionFields: { command?: string; verify?: string; link?: string } | null;
  importedFrom: ReportDraftEntryDto['importedFrom'];
  withdrawnReason: string | null;
  withdrawnAt: string | null;
  updatedAt: string;
}

function text(content: Record<string, unknown>, key: string): string {
  const value = content[key];
  return typeof value === 'string' ? value.trim() : '';
}

function detail(label: string | null, value: string): ReportDraftEntryDetail[] {
  return value ? [{ label, text: value }] : [];
}

function alternatives(content: Record<string, unknown>): string {
  const value = content.alternativesConsidered;
  if (!Array.isArray(value)) return '';
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim())
    .join('; ');
}

/**
 * Title and supporting lines for one entry. The human action's `blocking` and
 * `category` flags are deliberately not shown: a draft cannot create a
 * blocking obligation, so it must not look like one.
 */
export function describeReportDraftEntry(entry: ReportDraftEntryDto): ReportDraftEntryView {
  const content = (entry.content ?? {}) as Record<string, unknown>;
  let title = '';
  let details: ReportDraftEntryDetail[] = [];
  let humanActionFields: ReportDraftEntryView['humanActionFields'] = null;

  switch (entry.kind) {
    case 'human_action': {
      title = text(content, 'action');
      details = detail('Why', text(content, 'reason'));
      const command = text(content, 'command');
      const verify = text(content, 'verify');
      const link = text(content, 'link');
      humanActionFields =
        command || verify || link
          ? {
              ...(command ? { command } : {}),
              ...(verify ? { verify } : {}),
              ...(link ? { link } : {})
            }
          : null;
      break;
    }
    case 'tradeoff':
      title = text(content, 'decision');
      details = [
        ...detail('Why', text(content, 'rationale')),
        ...detail('Alternatives', alternatives(content)),
        ...detail('Impact', text(content, 'impact'))
      ];
      break;
    case 'deferred_work':
      title = text(content, 'title');
      details = [
        ...detail(null, text(content, 'change')),
        ...detail('Where', text(content, 'location')),
        ...detail('Done when', text(content, 'doneWhen'))
      ];
      break;
    case 'known_risk':
    case 'assumption':
    default:
      title = text(content, 'text');
      break;
  }

  return {
    entryId: entry.entryId,
    kind: entry.kind,
    kindLabel: reportDraftKindLabel(entry.kind),
    title: title || '(no text)',
    details,
    humanActionFields,
    importedFrom: entry.importedFrom,
    withdrawnReason: entry.withdrawnReason,
    withdrawnAt: entry.withdrawnAt,
    updatedAt: entry.updatedAt
  };
}

/**
 * What became of one entry of a sealed draft. A sealed entry names the V1
 * item of the accepted report; a null reference means the delivery excluded
 * it (normalization or eligibility). Open and abandoned drafts have no
 * outcome: their entries were never part of an accepted report.
 */
export function reportDraftEntryOutcome(
  draftState: ReportDraftState,
  entry: Pick<ReportDraftEntryDto, 'sealedRef'>
): string | null {
  if (draftState !== 'sealed') return null;
  return entry.sealedRef ? `In the accepted report as ${entry.sealedRef}` : 'Excluded at delivery';
}

/** The first 8 characters of a session id, for a compact source label. */
export function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

/** Withdrawn entries, tolerating a server that omits the optional array. */
export function withdrawnEntries(draft: ReportDraftDto): ReportDraftEntryDto[] {
  return draft.withdrawn ?? [];
}

/**
 * Display order: live executions first (they are what an operator is watching),
 * then the rest in the server's newest-first order. Stable within each group.
 */
export function orderReportDrafts(drafts: readonly ReportDraftDto[]): ReportDraftDto[] {
  return [
    ...drafts.filter(draft => draft.state === 'open'),
    ...drafts.filter(draft => draft.state !== 'open')
  ];
}

/** Total active entries across a draft's kinds. */
export function activeEntryCount(draft: ReportDraftDto): number {
  return draft.entries.length;
}
