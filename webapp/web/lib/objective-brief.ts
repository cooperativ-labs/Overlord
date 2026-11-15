import type { ObjectiveDto } from '@overlord/contract';

import { agentDisplayName } from './helpers/agent-icons.ts';

export type ObjectiveDescriptionFailureCode = NonNullable<ObjectiveDto['descriptionFailureCode']>;

/**
 * Presentation rules for an objective's human-facing summary (coo:1275, ADR 0057–0059).
 *
 * The summary (`ObjectiveDto.description`) is presentation only: the executing agent always
 * receives `instructionText`. Every surface that shows an objective reads the same answers
 * from here — whether a summary replaces the instruction body, which provenance line to
 * show, which of Summarize / Regenerate / Retry / Remove apply, and whether the prose
 * mentions a decision or a caution — so the queue card and the executed row cannot drift.
 *
 * Every field is read defensively: an older backend omits the brief fields entirely, and
 * that must render exactly like an objective with no summary.
 */

/** The brief fields this module reads; all optional so an older server's DTO still fits. */
export type ObjectiveBriefFields = Partial<
  Pick<
    ObjectiveDto,
    | 'description'
    | 'descriptionSource'
    | 'descriptionStale'
    | 'descriptionStatus'
    | 'descriptionFailureCode'
    | 'descriptionSuppressed'
    | 'descriptionEligible'
    | 'descriptionRevision'
    | 'descriptionAuthorWorkspaceUserId'
    | 'descriptionAuthorAgent'
  >
> & { instructionText: string };

/** Who the viewer's workspace knows; `isOperator` marks the viewer's own membership. */
export type BriefMember = {
  workspaceUserId: string;
  displayName: string;
  handle: string | null;
  email: string | null;
  isOperator: boolean;
};

/** Counts of the two prose markers the composer and STE writers use (plan §4.2). */
export type SummaryMentions = { decisions: number; cautions: number };

export type ObjectiveSummaryView = {
  /** Trimmed summary text, or null when the instruction body is the readable text. */
  summary: string | null;
  /** The summary split into its one to three prose paragraphs. */
  paragraphs: string[];
  /** A generation is outstanding (first summary, regeneration, or catch-up). */
  pending: boolean;
  /** The last generation failed for good; Retry is available. */
  failed: boolean;
  failureCode: ObjectiveDescriptionFailureCode | null;
  /** The summary was written from different instruction text. */
  stale: boolean;
  /** A person removed the summary; nothing is generated until someone selects Summarize. */
  suppressed: boolean;
  /** Instructions are long enough to summarize (server rule, ≥ 280 trimmed characters). */
  eligible: boolean;
  revision: number;
  /** Summarize is offered: no summary, eligible, nothing outstanding. Clears a removal. */
  canSummarize: boolean;
  /** Regenerate is offered: a summary exists, eligible, nothing outstanding. */
  canRegenerate: boolean;
  /** Retry is offered for a failed generation only. */
  canRetry: boolean;
  /** Remove is offered while there is a summary or a generation to stop. */
  canRemove: boolean;
  mentions: SummaryMentions;
};

const DECISION_MARKER = /(?:^|[.!?]["')\]]?\s+|\n\s*)decision needed:/gi;
const CAUTION_MARKER = /(?:^|[.!?]["')\]]?\s+|\n\s*)caution:/gi;

/** Counts sentences that start with `Decision needed:` or `CAUTION:` (case-insensitive). */
export function summaryMentions(text: string | null | undefined): SummaryMentions {
  if (!text) return { decisions: 0, cautions: 0 };
  return {
    decisions: text.match(DECISION_MARKER)?.length ?? 0,
    cautions: text.match(CAUTION_MARKER)?.length ?? 0
  };
}

/** Splits stored prose on blank lines; the composer joins paragraphs with one blank line. */
export function summaryParagraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n[ \t]*\n/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0);
}

/**
 * Splits one paragraph so the `Decision needed:` and `CAUTION:` prefixes can be emphasised.
 * Returns plain strings and marker strings in order; the caller renders them as text, never
 * as HTML.
 */
export function summaryMarkerSegments(
  paragraph: string
): Array<{ text: string; marker: 'decision' | 'caution' | null }> {
  const segments: Array<{ text: string; marker: 'decision' | 'caution' | null }> = [];
  const pattern = /(decision needed:|caution:)/gi;
  let last = 0;
  for (const match of paragraph.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = paragraph.slice(0, index);
    // Only a sentence-initial prefix is a marker; "use caution: …" mid-sentence is prose.
    const sentenceStart = index === 0 || /(?:[.!?]["')\]]?\s+|\n\s*)$/.test(before);
    if (!sentenceStart) continue;
    if (index > last) segments.push({ text: paragraph.slice(last, index), marker: null });
    segments.push({
      text: match[0],
      marker: match[0].toLowerCase().startsWith('decision') ? 'decision' : 'caution'
    });
    last = index + match[0].length;
  }
  if (last < paragraph.length) segments.push({ text: paragraph.slice(last), marker: null });
  return segments;
}

export function objectiveSummaryView(objective: ObjectiveBriefFields): ObjectiveSummaryView {
  const summary = objective.description?.trim() ? objective.description.trim() : null;
  const pending = objective.descriptionStatus === 'pending';
  const failed = objective.descriptionStatus === 'failed';
  const eligible = objective.descriptionEligible ?? false;
  const suppressed = objective.descriptionSuppressed ?? false;
  return {
    summary,
    paragraphs: summaryParagraphs(summary),
    pending,
    failed,
    failureCode: failed ? (objective.descriptionFailureCode ?? null) : null,
    stale: summary !== null && (objective.descriptionStale ?? false),
    suppressed,
    eligible,
    revision: objective.descriptionRevision ?? 0,
    canSummarize: summary === null && eligible && !pending && !failed,
    canRegenerate: summary !== null && eligible && !pending,
    canRetry: failed,
    canRemove: summary !== null || pending || failed,
    mentions: summaryMentions(summary)
  };
}

function memberName(member: BriefMember): string {
  return member.displayName.trim() || member.handle || member.email || 'a person';
}

/**
 * The provenance line under a summary (plan §4.12): "AI summary", "Written by Claude"
 * (or "Written by agent" when no identifier was recorded), and for a person's edit
 * "Edited by you" only for that person — every other viewer sees the editor's name, or
 * "Edited by a person" when the membership is not visible to them.
 */
export function summaryProvenanceLabel(
  objective: ObjectiveBriefFields,
  members: readonly BriefMember[] | undefined
): string | null {
  if (!objective.description?.trim()) return null;
  switch (objective.descriptionSource) {
    case 'generated':
      return 'AI summary';
    case 'agent': {
      const agent = agentDisplayName(objective.descriptionAuthorAgent ?? null);
      return agent ? `Written by ${agent}` : 'Written by agent';
    }
    case 'user': {
      const author = objective.descriptionAuthorWorkspaceUserId
        ? members?.find(m => m.workspaceUserId === objective.descriptionAuthorWorkspaceUserId)
        : undefined;
      if (!author) return 'Edited by a person';
      return author.isOperator ? 'Edited by you' : `Edited by ${memberName(author)}`;
    }
    default:
      return 'Summary';
  }
}

/** A failure line that never exposes provider text (the DTO carries stable codes only). */
export function summaryFailureMessage(code: ObjectiveDescriptionFailureCode | null): string {
  switch (code) {
    case 'provider_unavailable':
      return 'Summary unavailable: no model provider is configured.';
    case 'provider_error':
      return 'Summary unavailable: the model provider did not respond.';
    case 'invalid_output':
    case 'unfaithful_output':
      return 'Summary unavailable: no faithful summary could be written.';
    default:
      return 'Summary unavailable.';
  }
}

/** "1,240 characters" — the instruction disclosure label on summary layouts. */
export function instructionLengthLabel(instructionText: string): string {
  const count = instructionText.trim().length;
  return `${count.toLocaleString('en-US')} character${count === 1 ? '' : 's'}`;
}

/** Word count for the editor's advisory length hint; 120 is a target, not a limit. */
export function summaryWordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export const SUMMARY_TARGET_WORDS = 120;
/** Server cap on an authored description (400 `description_too_long`). */
export const SUMMARY_MAX_CHARACTERS = 4000;

/** Accessible/visible label for a mention badge: "1 decision", "2 cautions". */
export function mentionBadgeLabel(kind: 'decision' | 'caution', count: number): string {
  return `${count} ${kind}${count === 1 ? '' : 's'}`;
}
