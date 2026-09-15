import type { InboxItemDto, MissionDetailDto } from '../../shared/contract.ts';

import { PromotedInboxMissionCard } from './inbox-mission-card/PromotedInboxMissionCard.tsx';
import { UnassignedInboxMissionCard } from './inbox-mission-card/UnassignedInboxMissionCard.tsx';

export { InboxCardShell } from './inbox-mission-card/InboxCardShell.tsx';
export { PromotedInboxMissionCard, UnassignedInboxMissionCard };

type InboxMissionCardProps =
  | {
      variant: 'inbox';
      item: InboxItemDto;
      /** Called after promotion so the Inbox page can keep this card sticky. */
      onPromoted: (mission: MissionDetailDto) => void;
      /** Called after a plain (non-promoting) save; the task list collapses the editor. */
      onSaved?: () => void;
    }
  | {
      variant: 'mission';
      mission: MissionDetailDto;
    };

/**
 * Inbox capture card shaped like {@link NewMissionModal}: instruction body over a
 * footer toolbar. While unassigned, only text + project selection are available.
 * Choosing a project unlocks agent / resource / run. Promoting keeps the card on
 * the page as a live mission surface so the user can keep working without a
 * sudden navigation away from Inbox.
 */
export function InboxMissionCard(props: InboxMissionCardProps) {
  if (props.variant === 'mission') {
    return <PromotedInboxMissionCard initialMission={props.mission} />;
  }
  return (
    <UnassignedInboxMissionCard
      item={props.item}
      onPromoted={props.onPromoted}
      onSaved={props.onSaved}
    />
  );
}
