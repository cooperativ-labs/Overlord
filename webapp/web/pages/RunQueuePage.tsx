import { useParams } from '@tanstack/react-router';

import { RunQueuePanel } from '../components/run-queue/RunQueuePanel.tsx';

export function RunQueuePage() {
  const { projectId } = useParams({ from: '/projects/$projectId/queue' });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <RunQueuePanel projectId={projectId} />
    </div>
  );
}
