import type { CreatedByKind } from '../../shared/contract.ts';

import { agentDisplayName } from './helpers/agent-icons.ts';

/**
 * The one decision every provenance affordance makes: is there anything to say
 * about who authored this row, and if so, what?
 *
 * It lives apart from the components that render it because the same answer is
 * needed in four places (board card, list row, calendar cell, objective row)
 * and, more importantly, because it is the part worth testing: whether the mark
 * appears at all, and what a screen reader is told when it does.
 *
 * A `human` row returns null — no glyph, no tooltip, no aria-label. That is the
 * overwhelming majority of rows, and provenance that shouts on every card is
 * provenance nobody reads on the ones that matter.
 */
function originLabel({
  createdByKind,
  createdByAgent,
  verb,
  automationSubject
}: {
  createdByKind: CreatedByKind;
  createdByAgent: string | null;
  verb: string;
  automationSubject: string;
}): string | null {
  if (createdByKind === 'human') return null;
  if (createdByKind === 'automation') return `${verb} automatically by ${automationSubject}`;
  // An unmapped connector identifier still names itself through
  // `agentDisplayName`; "an agent" is only the floor when nothing was recorded.
  return `${verb} by ${agentDisplayName(createdByAgent) ?? 'an agent'}`;
}

/** Tooltip/aria text for a mission's origin mark, or null for a human-filed mission. */
export function missionOriginLabel(input: {
  createdByKind: CreatedByKind;
  createdByAgent: string | null;
}): string | null {
  return originLabel({ ...input, verb: 'Created', automationSubject: 'Overlord' });
}

/**
 * Tooltip/aria text for an objective's origin mark. "Added" rather than
 * "Created" because an objective is appended to a mission that already exists —
 * the distinction the mark exists to draw is *who appended this step*.
 */
export function objectiveOriginLabel(input: {
  createdByKind: CreatedByKind;
  createdByAgent: string | null;
}): string | null {
  return originLabel({ ...input, verb: 'Added', automationSubject: 'Overlord' });
}
