import { formatObjectiveDisplayId } from '@overlord/database';

import { presentationTitle } from './text-presentation.ts';

/**
 * The subject line every notification surface leads with.
 *
 * Live/activity surfaces are objective-first (coo:756 §9.1): when the row knows
 * which objective it was raised for, the body names that objective by its
 * display id and title, and the mission stays available as secondary context.
 * Rows with no objective (mission-level events, and every notification written
 * before objective ids were recorded) keep the mission form unchanged.
 */
export type NotificationSubject = {
  /** `coo:756.k7xm` when objective-scoped, otherwise `coo:756`. */
  displayId: string;
  /** Bounded, markdown-stripped title of whichever entity `displayId` names. */
  title: string;
  /** Mission display id — equal to `displayId` on mission-scoped rows. */
  missionDisplayId: string;
  /** Bounded mission title, for surfaces with room for a secondary line. */
  missionTitle: string;
  /** Present only when the subject is an objective. */
  objectiveDisplayId: string | null;
};

export function notificationSubject({
  missionDisplayId,
  missionTitle,
  objectiveDisplayKey,
  objectiveTitle
}: {
  missionDisplayId: string;
  missionTitle: string;
  /** `objectives.display_key` of the objective this notification is about, when known. */
  objectiveDisplayKey?: string | null;
  objectiveTitle?: string | null;
}): NotificationSubject {
  const mission = presentationTitle(missionTitle) || 'Untitled mission';
  const objectiveId = objectiveDisplayKey
    ? formatObjectiveDisplayId({ missionDisplayId, displayKey: objectiveDisplayKey })
    : null;
  // An untitled objective still deserves its own display id; the mission title
  // is the only human label available for it, so it is reused rather than
  // falling back to the mission's identity.
  const objective = objectiveTitle ? presentationTitle(objectiveTitle) : '';
  return {
    displayId: objectiveId ?? missionDisplayId,
    title: objectiveId ? objective || mission : mission,
    missionDisplayId,
    missionTitle: mission,
    objectiveDisplayId: objectiveId
  };
}

/** `coo:756.k7xm: Objective title started working` — one composition for both push and REST. */
export function notificationBody(subject: NotificationSubject, verb: string): string {
  return `${subject.displayId}: ${subject.title} ${verb}`;
}
