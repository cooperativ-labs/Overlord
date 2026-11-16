import type { SummaryProvenance } from '../../lib/mission-summary-derive.ts';

import { ObjectiveKeyLink } from './MissionSummaryParts.tsx';

/**
 * Who wrote the post (contract v173): the authoring objective's key as a link
 * when an agent wrote it at delivery, otherwise a short automatic label.
 */
export function MissionSummaryProvenanceLine({ provenance }: { provenance: SummaryProvenance }) {
  if (provenance.kind === 'automatic') {
    return <p className="text-xs text-(--color-ink-dim)">Written automatically from deliveries</p>;
  }
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-(--color-ink-dim)">
      <span>Updated by</span>
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
