import type { SummaryProvenance } from '../../lib/mission-summary-derive.ts';

import { ObjectiveKeyLink } from './MissionSummaryParts.tsx';

/**
 * Who wrote the post: its recorded author, never inferred from freshness (ADR 0076). Agent prose
 * names the authoring objective as a link; prose from the retired automatic composer says so.
 * `legacy` prose predates recorded coverage, so it is described as written, not as updated.
 */
export function MissionSummaryProvenanceLine({
  provenance,
  legacy = false
}: {
  provenance: SummaryProvenance;
  legacy?: boolean;
}) {
  if (provenance.kind === 'automatic') {
    return <p className="text-xs text-(--color-ink-dim)">Written automatically from deliveries</p>;
  }
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-(--color-ink-dim)">
      <span>{legacy ? 'Written by' : 'Updated by'}</span>
      {provenance.objectiveKey ? (
        <ObjectiveKeyLink
          objectiveKey={provenance.objectiveKey}
          ariaLabel={`Open objective ${provenance.objectiveKey}, which wrote this summary`}
        />
      ) : (
        <span>an agent</span>
      )}
    </p>
  );
}
