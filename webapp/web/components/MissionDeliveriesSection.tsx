import type { ObjectiveDto } from '../../shared/contract.ts';
import { useMissionDeliveries } from '../lib/queries.ts';

import { MissionDeliveryList } from './DeliverySummaryCard.tsx';
import { Spinner } from './ui.tsx';

function objectiveTitleById(objectives: ObjectiveDto[]): Map<string, string | null> {
  return new Map(objectives.map(objective => [objective.id, objective.title]));
}

export function MissionDeliveriesSection({
  missionId,
  objectives
}: {
  missionId: string;
  objectives: ObjectiveDto[];
}) {
  const deliveriesQ = useMissionDeliveries(missionId, true);
  const titleByObjectiveId = objectiveTitleById(objectives);

  if (deliveriesQ.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  }

  if (deliveriesQ.isError) {
    return (
      <p className="text-sm text-red-400">
        Could not load deliveries: {(deliveriesQ.error as Error)?.message ?? 'unknown error'}
      </p>
    );
  }

  const deliveries = deliveriesQ.data ?? [];
  if (deliveries.length === 0) {
    return <p className="text-sm italic text-(--color-ink-dim)">No deliveries yet.</p>;
  }

  return <MissionDeliveryList deliveries={deliveries} objectiveTitleById={titleByObjectiveId} />;
}
