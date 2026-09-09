import type { ObjectiveEvidence, ObjectiveEvidenceTruncation } from '../lib/objective-evidence.ts';

import {
  ObjectiveEvidenceRule,
  ObjectiveEvidenceTruncationNotice
} from './objectives/ObjectiveEvidenceRule.tsx';
import { MissionDeliveryList } from './DeliverySummaryCard.tsx';
import { LiveFileChangeList } from './LiveFileChangeList.tsx';

/**
 * Mission-level fallback for evidence whose objective is gone (coo:879 §4.6
 * item 4): deleting an objective is a soft delete, so its deliveries, file
 * changes, and sessions survive but lose their live parent. Rather than drop
 * them silently — the reader would think the work never happened — they are
 * surfaced here, below the mission-wide sections. Renders nothing when every
 * piece of evidence has a live objective, which is the normal case.
 */
export function UnassignedEvidenceSection({
  projectId,
  evidence,
  truncation
}: {
  projectId: string;
  evidence: ObjectiveEvidence;
  truncation?: ObjectiveEvidenceTruncation;
}) {
  const hasDeliveries = evidence.deliveries.length > 0;
  const hasFileChanges = evidence.fileChanges.length > 0;
  // Terminal sessions are not repeated here: the mission-level Latch section
  // (coo:990) already lists every session on the mission, including the ones
  // whose objective has been deleted.
  if (!hasDeliveries && !hasFileChanges) return null;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
          Unassigned evidence
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Produced by objectives that have since been deleted.
        </p>
      </div>
      <div className="grid gap-2">
        {hasDeliveries ? (
          <>
            <ObjectiveEvidenceRule label="Deliveries" count={evidence.deliveries.length} />
            <MissionDeliveryList deliveries={evidence.deliveries} objectiveTitleById={new Map()} />
            {truncation?.deliveries ? (
              <ObjectiveEvidenceTruncationNotice>
                {truncation.deliveries}
              </ObjectiveEvidenceTruncationNotice>
            ) : null}
          </>
        ) : null}
        {hasFileChanges ? (
          <>
            <ObjectiveEvidenceRule label="File changes" count={evidence.fileChanges.length} />
            <LiveFileChangeList projectId={projectId} fileChanges={evidence.fileChanges} />
            {truncation?.fileChanges ? (
              <ObjectiveEvidenceTruncationNotice>
                {truncation.fileChanges}
              </ObjectiveEvidenceTruncationNotice>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
