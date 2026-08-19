import type { SearchMatch, SearchResultV3 } from '@overlord/contract';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type VisibleSearchRow =
  | { kind: 'mission'; key: string; mission: SearchResultV3 }
  | { kind: 'match'; key: string; mission: SearchResultV3; match: SearchMatch };

export type SearchDestination = {
  to: '/projects/$projectId/missions/$missionId';
  params: { projectId: string; missionId: string };
  search?: { objective: string };
};

/**
 * Keeps the result order stable for both mouse and keyboard users. The full
 * page chooses which children are expanded; the combobox deliberately caps at
 * one child per mission.
 */
export function flattenSearchRows(
  results: SearchResultV3[],
  options: { childLimit: number; expandedMissionIds?: ReadonlySet<string> }
): VisibleSearchRow[] {
  return results.flatMap(mission => {
    const isExpanded = options.expandedMissionIds?.has(mission.id) ?? false;
    const childLimit = isExpanded ? mission.matches.length : options.childLimit;
    return [
      { kind: 'mission' as const, key: `mission:${mission.id}`, mission },
      ...mission.matches.slice(0, childLimit).map(match => ({
        kind: 'match' as const,
        key: `match:${match.id}`,
        mission,
        match
      }))
    ];
  });
}

/** Delivery rows intentionally use their owning objective's existing deep link. */
export function searchDestination(mission: SearchResultV3, match?: SearchMatch): SearchDestination {
  const objective = match?.displayId ?? match?.objectiveId ?? undefined;
  return {
    to: '/projects/$projectId/missions/$missionId',
    params: { projectId: mission.projectId, missionId: mission.id },
    ...(objective ? { search: { objective } } : {})
  };
}

export function highlightParts(
  text: string,
  terms: readonly string[]
): Array<{ text: string; hit: boolean }> {
  const normalized = [...new Set(terms.map(term => term.trim()).filter(Boolean))].sort(
    (left, right) => right.length - left.length
  );
  if (!normalized.length) return [{ text, hit: false }];
  const expression = new RegExp(`(${normalized.map(escapeRegex).join('|')})`, 'gi');
  return text
    .split(expression)
    .filter(Boolean)
    .map(part => ({
      text: part,
      hit: normalized.some(term => term.toLowerCase() === part.toLowerCase())
    }));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedText({ text, terms }: { text: string; terms: readonly string[] }) {
  return highlightParts(text, terms).map((part, index) =>
    part.hit ? (
      <mark
        key={index}
        className="rounded bg-amber-300/45 px-0.5 text-inherit dark:bg-amber-400/30"
      >
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    )
  );
}

function KindBadge({ match }: { match?: SearchMatch }) {
  if (!match) {
    return (
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
        Mission
      </span>
    );
  }
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-medium',
        match.entityType === 'objective'
          ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      )}
    >
      {match.entityType === 'objective' ? 'Objective' : 'Delivery'}
    </span>
  );
}

/** Shared presentation for anchor and child rows in the page and combobox. */
export function SearchResultRowContent({
  row,
  compact = false
}: {
  row: VisibleSearchRow;
  compact?: boolean;
}): ReactNode {
  const match = row.kind === 'match' ? row.match : undefined;
  const title = match?.title || row.mission.title || 'Untitled mission';
  const terms = match?.matchedTerms ?? row.mission.matchedTerms;
  const snippet = match?.snippet ?? row.mission.snippet;

  return (
    <div className={cn('min-w-0', row.kind === 'match' && 'border-l border-border pl-3')}>
      <div className="flex min-w-0 items-center gap-2">
        {row.kind === 'match' && (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <KindBadge match={match} />
        {!match && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
            {row.mission.statusType}
          </span>
        )}
        {match?.objectiveState && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {match.objectiveState.replace('_', ' ')}
          </span>
        )}
        <span className="truncate text-sm font-medium">
          <HighlightedText text={title} terms={terms} />
        </span>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {row.kind === 'match'
          ? `${row.match.displayId ?? 'Delivery'} · ${row.mission.displayId}`
          : `${row.mission.displayId} · ${row.mission.projectName}`}
      </p>
      {!compact && snippet && snippet !== title && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          <HighlightedText text={snippet} terms={terms} />
        </p>
      )}
    </div>
  );
}

export function SearchCompletenessNotice({
  totalMatchedBeforeLimit,
  returned,
  truncatedCandidates
}: {
  totalMatchedBeforeLimit: number;
  returned: number;
  truncatedCandidates: boolean;
}) {
  if (truncatedCandidates) {
    return (
      <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
        Results are incomplete: the search candidate limit was reached, so counts are lower bounds.
      </p>
    );
  }
  if (returned < totalMatchedBeforeLimit) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Showing {returned} of {totalMatchedBeforeLimit} matching missions.
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {returned} matching mission{returned === 1 ? '' : 's'}.
    </p>
  );
}
