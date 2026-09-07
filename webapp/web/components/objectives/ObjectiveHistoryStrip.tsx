import { ChevronDown, History } from 'lucide-react';
import { useState } from 'react';

import type { ObjectiveDto } from '../../../shared/contract.ts';
import { formatObjectiveElapsed, type ObjectiveEvidence } from '../../lib/objective-evidence.ts';
import { cn } from '../../lib/utils.ts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx';

import {
  type ObjectiveEvidenceLoading,
  ObjectiveEvidenceSections
} from './ObjectiveEvidenceSections.tsx';

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The read-only "Previous runs" strip a reverted draft carries between its
 * editable instruction and its toolbar (coo:879 §4.5). Setting a completed
 * objective back to draft keeps every delivery, file change, and terminal
 * session at the data layer; this is the surface that proves it. The strip
 * reuses the same evidence sections a completed objective renders, so the
 * history looks identical whether the objective is complete or editable again.
 *
 * Collapsed by default: the draft is being edited to run again, and its past
 * is secondary to that — which is exactly the case where nesting is allowed.
 */
export function ObjectiveHistoryStrip({
  objective,
  evidence,
  loading
}: {
  objective: ObjectiveDto;
  evidence: ObjectiveEvidence;
  loading: ObjectiveEvidenceLoading;
}) {
  const [open, setOpen] = useState(false);
  const summary = [
    evidence.deliveries.length > 0
      ? countLabel(evidence.deliveries.length, 'delivery', 'deliveries')
      : null,
    evidence.fileChanges.length > 0
      ? countLabel(evidence.fileChanges.length, 'file', 'files')
      : null,
    evidence.terminalSessions.length > 0
      ? countLabel(evidence.terminalSessions.length, 'session', 'sessions')
      : null
  ]
    .filter(Boolean)
    .join(' · ');
  const elapsed = formatObjectiveElapsed({
    startedAt: objective.startedAt,
    completedAt: objective.completedAt
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border-t border-border/40">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground outline-none hover:bg-muted/40">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="font-medium">Previous runs</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/80">
            {summary}
            {elapsed ? ` · ${elapsed}` : ''}
          </span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <ObjectiveEvidenceSections
            objective={objective}
            evidence={evidence}
            mode="history"
            loading={loading}
          />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
