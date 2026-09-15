import type { InboxItemDto, MissionDetailDto } from '../../../shared/contract.ts';

import { InboxCardShell } from './InboxCardShell.tsx';
import { useUnassignedInboxCard } from './use-unassigned-inbox-card.ts';

export function UnassignedInboxMissionCard({
  item,
  onPromoted,
  onSaved
}: {
  item: InboxItemDto;
  onPromoted: (mission: MissionDetailDto) => void;
  onSaved?: () => void;
}) {
  const card = useUnassignedInboxCard({ item, onPromoted, onSaved });
  return <InboxCardShell {...card} showDelete assignedBanner={null} />;
}
