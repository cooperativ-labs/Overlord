import { useEffect, useState } from 'react';

import { useUpdateMission } from '../../lib/queries.ts';

import { DueDatePickerButton } from './DueDatePickerButton.tsx';

type DueDateEditorProps = {
  initialDueDatetime: string | null;
  missionId: string;
};

/** Mission-bound due date: the shared picker button wired to `PATCH /api/missions/:id`. */
export function DueDateEditor({ initialDueDatetime, missionId }: DueDateEditorProps) {
  const update = useUpdateMission(missionId);
  const [dueDatetime, setDueDatetime] = useState(initialDueDatetime);

  useEffect(() => {
    setDueDatetime(initialDueDatetime);
  }, [initialDueDatetime]);

  return (
    <DueDatePickerButton
      value={dueDatetime}
      onChange={async next => {
        await update.mutateAsync({ dueDatetime: next });
        setDueDatetime(next);
      }}
    />
  );
}
