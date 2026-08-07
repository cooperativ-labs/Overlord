import { useUpdateMission } from '../lib/queries.ts';

import { InlineEditField } from './InlineEditField.tsx';

interface MissionNotesProps {
  missionId: string;
  notes: string | null;
}

export function MissionNotes({ missionId, notes }: MissionNotesProps) {
  const update = useUpdateMission(missionId);

  return (
    <div className="space-y-2 pb-4">
      <div className="space-y-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Private notes for you and other human viewers. These are not sent to agents.
        </p>
      </div>
      <div className="pl-2">
        <InlineEditField
          className="block text-sm leading-relaxed"
          value={notes ?? ''}
          multiline
          ariaLabel="Mission notes"
          placeholder="Add notes for yourself — click to edit."
          onSave={next => update.mutate({ notes: next || null })}
        />
      </div>
    </div>
  );
}
