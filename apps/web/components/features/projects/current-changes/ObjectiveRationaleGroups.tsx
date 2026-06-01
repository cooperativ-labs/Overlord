import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { FileChangeRecord } from './types';

export type ObjectiveGroup = {
  objectiveId: string | null;
  objectiveText: string | null;
  hasCheckpoint: boolean;
  rationales: FileChangeRecord[];
};

export function groupRationalesByObjective(rationales: FileChangeRecord[]): ObjectiveGroup[] {
  const groups = new Map<string, ObjectiveGroup>();
  for (const rationale of rationales) {
    const key = rationale.objective?.id ?? '__none__';
    let group = groups.get(key);
    if (!group) {
      group = {
        objectiveId: rationale.objective?.id ?? null,
        objectiveText: rationale.objective?.objective ?? null,
        hasCheckpoint: false,
        rationales: []
      };
      groups.set(key, group);
    }
    group.rationales.push(rationale);
    if (rationale.checkpoint?.git_commit_id) group.hasCheckpoint = true;
  }
  return [...groups.values()];
}

export function ObjectiveRationaleGroups({
  groups,
  onRevert
}: {
  groups: ObjectiveGroup[];
  onRevert: (objectiveId: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Rationales by objective
      </p>
      {groups.map((group, index) => (
        <div
          key={group.objectiveId ?? `none-${index}`}
          className="rounded-md border bg-muted/20 p-2"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 text-xs text-foreground">
              {group.objectiveText?.trim() || (group.objectiveId ? 'Objective' : 'No objective')}
            </p>
            {group.objectiveId && group.hasCheckpoint ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => onRevert(group.objectiveId!)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Revert
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Restore the working tree to this objective&apos;s checkpoint
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {group.rationales.map(rationale => (
              <li key={rationale.id} className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{rationale.label}</span>
                {rationale.summary ? <> — {rationale.summary}</> : null}
                {rationale.why || rationale.impact ? (
                  <span className="mt-0.5 block">
                    {rationale.why ? <em>Why: {rationale.why}. </em> : null}
                    {rationale.impact ? <em>Impact: {rationale.impact}.</em> : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
